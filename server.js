const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const usersFile = path.join(ROOT, 'users.json');
const studentsFile = path.join(ROOT, 'students.json');
const settingsFile = path.join(ROOT, 'exam_settings.json');
const submissionsFile = path.join(ROOT, 'submissions.json');
const questionsDir = path.join(ROOT, 'questions_by_subject');
const uploadsDir = path.join(ROOT, 'uploads', 'questions');
const snapshotsDir = path.join(ROOT, 'snapshots');
const examStatusFile = path.join(ROOT, 'exam_status.json');
const cheatLogsFile = path.join(ROOT, 'cheat_logs.json');
const examsFile = path.join(ROOT, 'exams.json');
const auditLogsFile = path.join(ROOT, 'audit_logs.json');
const EXAM_MS = 120 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const studentSessions = new Map();
const subjectExamStatus = new Map();
const activeStudents = new Map();
const studentWarnings = new Map();
const studentForceSubmits = new Set();
const studentLiveState = new Map();
const studentDraftAnswers = new Map();
const logs = [];
let globalExam = null;

function logAudit(actorId, actorName, action, details) {
    try {
        const audit = readJSON(auditLogsFile, []);
        audit.unshift({
            id: token().slice(0, 12),
            timestamp: new Date().toISOString(),
            actorId: String(actorId || 'SYSTEM').slice(0, 50),
            actorName: String(actorName || 'System').slice(0, 100),
            action: String(action || 'ACTION').slice(0, 50),
            details: String(details || '').slice(0, 500)
        });
        if (audit.length > 500) audit.length = 500;
        writeJSON(auditLogsFile, audit);
    } catch (e) {
        console.error('Audit log error:', e);
    }
}

function getExamsList() {
    let exams = readJSON(examsFile, null);
    if (!exams) {
        exams = [
            {
                id: 'EXAM_DSA_AUT',
                title: 'Data Structures & Algorithms In-Semester Examination',
                subject: 'DSA',
                className: 'SY-AIML',
                division: 'ALL',
                examDate: new Date().toISOString().split('T')[0],
                startTime: '10:00',
                duration: 60,
                totalMarks: 20,
                instructions: '1. All questions are compulsory.\n2. Do not switch tabs or minimize the browser.\n3. Face must remain centered in camera frame.\n4. Answers are auto-saved on selection.',
                status: 'Scheduled',
                showResults: false,
                createdAt: new Date().toISOString()
            },
            {
                id: 'EXAM_AI_AUT',
                title: 'Artificial Intelligence & Machine Learning Mid-Term Test',
                subject: 'AI',
                className: 'SY-AIML',
                division: 'ALL',
                examDate: new Date().toISOString().split('T')[0],
                startTime: '14:00',
                duration: 60,
                totalMarks: 20,
                instructions: '1. All questions are compulsory.\n2. Maintain full focus within camera viewport.\n3. Automatic submission will trigger when timer expires.',
                status: 'Scheduled',
                showResults: false,
                createdAt: new Date().toISOString()
            }
        ];
        writeJSON(examsFile, exams);
    }
    return exams;
}

for (const dir of [questionsDir, uploadsDir, snapshotsDir]) fs.mkdirSync(dir, { recursive: true });
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

function readJSON(file, fallback = []) {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}
function validSubject(subject) {
    return typeof subject === 'string' && /^[A-Za-z0-9 _-]{1,64}$/.test(subject) && subject.trim() === subject;
}
function questionFile(subject) {
    if (!validSubject(subject)) return null;
    return path.join(questionsDir, subject + '.json');
}
function getQuestions(subject) {
    const file = questionFile(subject);
    return file ? readJSON(file) : [];
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function cookie(req, name) {
    const found = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
    return found ? found.slice(name.length + 1) : '';
}
function setCookie(res, name, value, maxAge) {
    res.cookie(name, value, { httpOnly: true, sameSite: 'lax', secure: false, maxAge, path: '/' });
}
function currentStaff(req) {
    const session = sessions.get(cookie(req, 'staff_session'));
    if (!session || session.expires < Date.now()) return null;
    return session.user;
}
function currentStudent(req) {
    const session = studentSessions.get(cookie(req, 'student_session'));
    if (!session || session.expires < Date.now()) return null;
    return session;
}
function staff(...roles) {
    return (req, res, next) => {
        const user = currentStaff(req);
        if (!user) return res.status(401).json({ error: 'Staff login required' });
        if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'Role not permitted' });
        req.staff = user;
        next();
    };
}
function student(req, res, next) {
    req.student = currentStudent(req);
    if (!req.student) return res.status(401).json({ error: 'Join the exam first' });
    next();
}
function ownSubject(req, res, next) {
    if (req.staff.role === 'FACULTY' && req.staff.subject !== (req.body.subject || req.query.subject))
        return res.status(403).json({ error: 'This is not your subject' });
    next();
}
function activeExam(subject) {
    const exam = subjectExamStatus.has(subject) ? subjectExamStatus.get(subject) : globalExam;
    return exam && exam.active && Date.now() < exam.deadline ? exam : null;
}
function publicUser(user) {
    const { password, passwordHash, ...safe } = user;
    return safe;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, hash) {
    if (!password || !hash) return false;
    if (hash === password) return true;
    if (typeof hash !== 'string' || !hash.includes(':')) return hash === password;
    try {
        const [salt, hex] = hash.split(':');
        const expected = Buffer.from(hex, 'hex');
        const actual = crypto.scryptSync(password, salt, expected.length);
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch {
        return hash === password;
    }
}
function bootstrap() {
    const users = readJSON(usersFile);
    const defaults = [
        { id: 'HOD001', role: 'HOD', name: 'Super Admin HOD', passwordHash: hashPassword('admin') },
        { id: 'FAC001', role: 'FACULTY', name: 'Prof. Rajesh Sharma', subject: 'DSA', passwordHash: hashPassword('faculty') },
        { id: 'CLASSAAIML', role: 'CLASS_TEACHER', name: 'DEVIDAS THOSAR', className: 'SY-AIML A', passwordHash: hashPassword('CLASSA2026') },
        { id: 'CLASSBAIML', role: 'CLASS_TEACHER', name: 'PRIYANKA KUTE', className: 'SY-AIML B', passwordHash: hashPassword('CLASSB2026') },
        { id: 'CLASSCAIML', role: 'CLASS_TEACHER', name: 'SHWETA LILHARE', className: 'SY-AIML C', passwordHash: hashPassword('CLASSC2026') }
    ];
    let changed = false;
    for (const d of defaults) {
        const existing = users.find(u => u.id === d.id);
        if (!existing) {
            users.push(d);
            changed = true;
        } else if (!existing.passwordHash && existing.password) {
            existing.passwordHash = hashPassword(existing.password);
            delete existing.password;
            changed = true;
        }
    }
    if (process.env.BOOTSTRAP_HOD_ID && process.env.BOOTSTRAP_HOD_PASSWORD) {
        if (process.env.BOOTSTRAP_HOD_PASSWORD.length >= 12) {
            const existingHod = users.find(u => u.id === process.env.BOOTSTRAP_HOD_ID && u.role === 'HOD');
            if (existingHod) {
                existingHod.passwordHash = hashPassword(process.env.BOOTSTRAP_HOD_PASSWORD);
            } else {
                users.push({ id: process.env.BOOTSTRAP_HOD_ID, role: 'HOD', name: 'HOD', passwordHash: hashPassword(process.env.BOOTSTRAP_HOD_PASSWORD) });
            }
            changed = true;
        }
    }
    if (changed || !fs.existsSync(usersFile)) {
        writeJSON(usersFile, users);
    }
}
function loadPersistentExams() {
    const data = readJSON(examStatusFile, {});
    if (data.globalExam && data.globalExam.active && Date.now() < data.globalExam.deadline) {
        globalExam = data.globalExam;
    }
    if (data.subjectExams && typeof data.subjectExams === 'object') {
        for (const [sub, ex] of Object.entries(data.subjectExams)) {
            if (ex && ex.active && Date.now() < ex.deadline) {
                subjectExamStatus.set(sub, ex);
            }
        }
    }
}
function savePersistentExams() {
    const subjectExams = {};
    for (const [sub, ex] of subjectExamStatus.entries()) {
        subjectExams[sub] = ex;
    }
    writeJSON(examStatusFile, { globalExam, subjectExams });
}
bootstrap();
loadPersistentExams();

// Serve only selected browser assets. Data files and snapshots are never public.
app.get(['/', '/staff'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/student', (req, res) => res.sendFile(path.join(ROOT, 'student.html')));
for (const asset of ['campus_scene.css', 'campus_3d.js', 'portal_ui.css', 'cybervidya_bg.webp', 'latest_raisoni_logo.svg', 'ghrce_simha_logo.webp']) {
    app.get('/' + asset, (req, res) => res.sendFile(path.join(ROOT, asset)));
}
app.get('/uploads/questions/:file', (req, res) => {
    const name = req.params.file;
    if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(name)) return res.sendStatus(400);
    if (!currentStaff(req) && !currentStudent(req)) return res.sendStatus(401);
    res.sendFile(path.join(uploadsDir, name));
});

app.post('/api/login', (req, res) => {
    const { id, password, role } = req.body;
    const cleanId = String(id || '').trim();
    const cleanPass = String(password || '').trim();
    const users = readJSON(usersFile);
    // 1. Try finding user matching ID and specified role (case-insensitive ID)
    let found = users.find(u => u.id.toLowerCase() === cleanId.toLowerCase() && (!role || u.role === role));
    // 2. If not found under specified role, check if ID exists under any role (auto-detect)
    if (!found) {
        found = users.find(u => u.id.toLowerCase() === cleanId.toLowerCase());
    }
    // 3. Verify password (try exact, lowercase, and uppercase)
    const isPassValid = found && cleanPass && (
        verifyPassword(cleanPass, found.passwordHash || found.password) ||
        verifyPassword(cleanPass.toUpperCase(), found.passwordHash || found.password) ||
        verifyPassword(cleanPass.toLowerCase(), found.passwordHash || found.password)
    );
    if (!found || !isPassValid)
        return res.status(401).json({ error: 'Invalid Staff ID or Password' });
    const key = token();
    sessions.set(key, { user: publicUser(found), expires: Date.now() + SESSION_MS });
    setCookie(res, 'staff_session', key, SESSION_MS);
    res.json({ success: true, user: publicUser(found) });
});
app.post('/api/logout', (req, res) => {
    sessions.delete(cookie(req, 'staff_session'));
    res.clearCookie('staff_session', { path: '/' });
    res.json({ success: true });
});
app.post('/api/create-user', staff('HOD', 'CLASS_TEACHER'), (req, res) => {
    const { id, password, role, name, subject, className, dept } = req.body;
    if (req.staff.role === 'CLASS_TEACHER' && role !== 'FACULTY')
        return res.status(403).json({ error: 'Class teachers may only create faculty accounts' });
    if (!['HOD', 'CLASS_TEACHER', 'FACULTY'].includes(role) || !/^[A-Za-z0-9_-]{3,32}$/.test(id || '') ||
        typeof password !== 'string' || password.length < 12 || !name)
        return res.status(400).json({ error: 'Valid ID, name, role and password of at least 12 characters required' });
    if (role === 'FACULTY' && !validSubject(subject)) return res.status(400).json({ error: 'Valid subject required' });
    const users = readJSON(usersFile);
    if (users.some(u => u.id === id)) return res.status(409).json({ error: 'ID already exists' });
    users.push({ id, passwordHash: hashPassword(password), role, name, subject, className, dept });
    writeJSON(usersFile, users);
    res.json({ success: true });
});
app.post('/api/reset-password', staff('HOD'), (req, res) => {
    const { id, password } = req.body;
    if (typeof password !== 'string' || password.length < 12) return res.sendStatus(400);
    const users = readJSON(usersFile);
    const found = users.find(u => u.id === id);
    if (!found) return res.sendStatus(404);
    found.passwordHash = hashPassword(password);
    delete found.password;
    writeJSON(usersFile, users);
    // Invalidate any active sessions belonging to this account.
    for (const [key, session] of sessions)
        if (session.user.id === id) sessions.delete(key);
    res.json({ success: true });
});
app.get('/api/get-staff', staff('HOD', 'CLASS_TEACHER'), (req, res) => {
    res.json(readJSON(usersFile).map(publicUser));
});

// Excel & CSV Student Roster Upload
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/upload-students', staff('HOD', 'CLASS_TEACHER'), excelUpload.single('file'), (req, res) => {
    let rawList = [];
    if (req.file) {
        try {
            const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            rawList = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
        } catch (err) {
            return res.status(400).json({ error: 'Failed to parse Excel file: ' + err.message });
        }
    } else if (Array.isArray(req.body.students)) {
        rawList = req.body.students;
    } else if (req.body.csvText) {
        // Fallback CSV parser
        const lines = req.body.csvText.split(/\r?\n/).filter(l => l.trim());
        if (lines.length > 1) {
            const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
            rawList = lines.slice(1).map(line => {
                const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
                const obj = {};
                headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
                return obj;
            });
        }
    } else {
        return res.status(400).json({ error: 'No Excel file or student list provided' });
    }

    if (!rawList.length) return res.status(400).json({ error: 'The uploaded file contains no rows' });

    const normalized = rawList.map(row => {
        let rollNo = '', name = '', className = '', division = '', dept = '';
        for (const [k, v] of Object.entries(row)) {
            const cleanKey = k.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            const val = String(v || '').trim();
            if (['roll', 'rollno', 'prn', 'id', 'studentroll', 'rollnumber', 'seatno'].includes(cleanKey)) rollNo = val;
            else if (['name', 'studentname', 'fullname', 'candidate', 'candidatename'].includes(cleanKey)) name = val;
            else if (['class', 'classname', 'divisionclass', 'standard', 'year'].includes(cleanKey)) className = val;
            else if (['div', 'division', 'sec', 'section'].includes(cleanKey)) division = val;
            else if (['dept', 'department', 'branch', 'programme'].includes(cleanKey)) dept = val;
        }
        if (!className && req.staff.className) className = req.staff.className;
        if (!division && className) {
            const match = className.match(/\b([A-D])\b/i);
            if (match) division = match[1].toUpperCase();
        }
        return {
            rollNo: rollNo || String(row.rollNo || row.roll || ''),
            name: name || String(row.name || ''),
            className: className || req.staff.className || 'SY-AIML',
            division: division || 'A',
            dept: dept || 'Computer Engineering & AI'
        };
    }).filter(s => s.rollNo && s.name);

    if (!normalized.length) return res.status(400).json({ error: 'No valid student records found (Roll No and Name are required)' });

    const existing = readJSON(studentsFile, []);
    let added = 0, updated = 0;
    for (const student of normalized) {
        const idx = existing.findIndex(s => s.rollNo.toUpperCase() === student.rollNo.toUpperCase());
        if (idx >= 0) {
            existing[idx] = { ...existing[idx], ...student };
            updated++;
        } else {
            existing.push(student);
            added++;
        }
    }
    writeJSON(studentsFile, existing);
    res.json({ success: true, added, updated, total: existing.length });
});

app.get('/api/get-students', staff('HOD', 'CLASS_TEACHER', 'FACULTY'), (req, res) => {
    const students = readJSON(studentsFile, []);
    const submissions = readJSON(submissionsFile, []);
    const users = readJSON(usersFile, []);
    
    // Automatically include any student who submitted an exam
    const knownRolls = new Set(students.map(s => (s.rollNo || '').toUpperCase()));
    submissions.forEach(sub => {
        if (sub.rollNo && !knownRolls.has(sub.rollNo.toUpperCase())) {
            students.push({
                rollNo: sub.rollNo,
                name: sub.name || ('Candidate ' + sub.rollNo),
                className: 'SY-AIML A',
                division: 'A',
                dept: 'Computer Engineering & AI'
            });
            knownRolls.add(sub.rollNo.toUpperCase());
        }
    });

    // Discover all available subjects
    const subjectsSet = new Set(['DSA', 'AI', 'DBMS', 'Web Technology']);
    users.filter(u => u.subject).forEach(u => subjectsSet.add(u.subject));
    submissions.forEach(s => subjectsSet.add(s.subject));
    const allKnownSubjects = Array.from(subjectsSet);

    const divFilter = (req.query.division || req.query.className || '').trim().toUpperCase();
    const isCT = req.staff.role === 'CLASS_TEACHER';
    const ctClass = (req.staff.className || '').toUpperCase();
    const isFac = req.staff.role === 'FACULTY';
    const facSub = (req.staff.subject || '').toUpperCase();

    // Cache snapshots and cheat logs
    const persistentLogs = readJSON(cheatLogsFile, []);
    let snapshotDirs = [];
    try {
        if (fs.existsSync(snapshotsDir)) {
            snapshotDirs = fs.readdirSync(snapshotsDir);
        }
    } catch(e) {}

    const enriched = students.filter(s => {
        if (divFilter && divFilter !== 'ALL') {
            return (s.division || '').toUpperCase() === divFilter || (s.className || '').toUpperCase().includes(divFilter);
        }
        if (isCT && ctClass && (!divFilter || divFilter === 'ALL')) {
            // By default filter to this Class Teacher's class/division unless explicitly requesting all
            const matchesClass = (s.className || '').toUpperCase() === ctClass;
            const matchesDiv = s.division && ctClass.includes(s.division.toUpperCase());
            return matchesClass || matchesDiv;
        }
        return true;
    }).map(st => {
        const rollUpper = (st.rollNo || '').toUpperCase();
        const studentSubs = submissions.filter(sub => sub.rollNo && sub.rollNo.toUpperCase() === rollUpper);
        const givenSubjects = studentSubs.map(s => ({
            subject: s.subject,
            score: s.score,
            rawScore: s.rawScore,
            total: s.total,
            time: s.time,
            isOverridden: !!s.isOverridden,
            overrideReason: s.overrideReason || null,
            overriddenBy: s.overriddenBy || null,
            overriddenAt: s.overriddenAt || null
        }));
        const givenSubjectNames = new Set(givenSubjects.map(g => g.subject.toUpperCase()));
        const pendingSubjects = allKnownSubjects.filter(sub => !givenSubjectNames.has(sub.toUpperCase()));

        let studentSnapshots = 0;
        let subjectSnapshots = 0;
        snapshotDirs.forEach(dir => {
            const dirUpper = dir.toUpperCase();
            if (dirUpper.includes(rollUpper)) {
                try {
                    const fullP = path.join(snapshotsDir, dir);
                    if (fs.statSync(fullP).isDirectory()) {
                        const count = fs.readdirSync(fullP).filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png')).length;
                        studentSnapshots += count;
                        if (facSub && dirUpper.includes(facSub)) {
                            subjectSnapshots += count;
                        }
                    }
                } catch(e) {}
            }
        });

        const studentLogs = persistentLogs.filter(l => l.rollNo && l.rollNo.toUpperCase() === rollUpper);
        const subjectLogs = facSub ? studentLogs.filter(l => l.subject && l.subject.toUpperCase() === facSub) : studentLogs;

        return {
            ...st,
            hasGivenExam: givenSubjects.length > 0,
            givenCount: givenSubjects.length,
            pendingCount: pendingSubjects.length,
            givenSubjects,
            pendingSubjects,
            snapshotCount: studentSnapshots,
            subjectSnapshotCount: facSub ? (subjectSnapshots || studentSnapshots) : studentSnapshots,
            violationCount: studentLogs.length,
            subjectViolationCount: facSub ? subjectLogs.length : studentLogs.length,
            hasViolations: (studentLogs.length > 0 || studentSnapshots > 0),
            hasSubjectViolations: (subjectLogs.length > 0 || subjectSnapshots > 0 || (facSub ? studentSnapshots > 0 : false))
        };
    });

    res.json({
        students: enriched,
        total: enriched.length,
        totalGiven: enriched.filter(s => s.hasGivenExam).length,
        totalNotGiven: enriched.filter(s => !s.hasGivenExam).length,
        allSubjects: allKnownSubjects
    });
});

app.get('/api/student-all-marks', staff('HOD', 'CLASS_TEACHER', 'FACULTY'), (req, res) => {
    const rollNo = String(req.query.rollNo || '').trim().toUpperCase();
    if (!rollNo) return res.status(400).json({ error: 'Roll number required' });

    const students = readJSON(studentsFile, []);
    const student = students.find(s => s.rollNo.toUpperCase() === rollNo) || { rollNo, name: 'Student ' + rollNo };
    const submissions = readJSON(submissionsFile, []);
    const users = readJSON(usersFile, []);

    // Discover all available subjects & their assigned faculty
    const subjectsSet = new Set(['DSA', 'AI', 'DBMS', 'Web Technology']);
    users.filter(u => u.subject).forEach(u => subjectsSet.add(u.subject));
    submissions.forEach(s => subjectsSet.add(s.subject));

    const records = Array.from(subjectsSet).map(subj => {
        const sub = submissions.find(s => s.rollNo.toUpperCase() === rollNo && s.subject.toUpperCase() === subj.toUpperCase());
        const teacher = users.find(u => u.role === 'FACULTY' && u.subject && u.subject.toUpperCase() === subj.toUpperCase());
        if (sub) {
            const raw = sub.rawScore !== undefined ? sub.rawScore : (parseInt(sub.score) || 0);
            const tot = sub.total || 20;
            const pct = Math.round((raw / tot) * 100);
            return {
                subject: subj,
                facultyName: teacher ? teacher.name : 'Department Faculty',
                hasGiven: true,
                status: 'Completed',
                score: sub.score,
                rawScore: raw,
                total: tot,
                percentage: pct,
                time: sub.time,
                isOverridden: !!sub.isOverridden,
                overrideReason: sub.overrideReason || null,
                overriddenBy: sub.overriddenBy || null,
                overriddenAt: sub.overriddenAt || null
            };
        } else {
            return {
                subject: subj,
                facultyName: teacher ? teacher.name : 'Department Faculty',
                hasGiven: false,
                status: 'Not Given / Absent',
                score: '—',
                rawScore: null,
                total: 20,
                percentage: null,
                time: null,
                isOverridden: false,
                overrideReason: null,
                overriddenBy: null,
                overriddenAt: null
            };
        }
    });

    const givenRecords = records.filter(r => r.hasGiven);
    const avgPct = givenRecords.length ? Math.round(givenRecords.reduce((sum, r) => sum + r.percentage, 0) / givenRecords.length) : 0;

    res.json({
        student,
        marks: records,
        stats: {
            totalSubjects: records.length,
            examsGiven: givenRecords.length,
            examsPending: records.length - givenRecords.length,
            averagePercentage: avgPct
        }
    });
});

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, token() + (file.mimetype === 'image/png' ? '.png' : '.jpg'))
});
const upload = multer({ storage, limits: { fileSize: 3 * 1024 * 1024 }, fileFilter: (_req, file, cb) =>
    cb(null, ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.mimetype)) });
app.post('/api/upload-question', staff('HOD', 'FACULTY'), upload.single('questionImage'), ownSubject, (req, res) => {
    const { subject, correctOption, marks, type, questionText, optionA, optionB, optionC, optionD } = req.body;
    if (!validSubject(subject) || !/^[A-D]$/i.test(correctOption || ''))
        return res.status(400).json({ error: 'Valid subject and correct option A–D required' });

    const isTextMode = type === 'text' || (!req.file && Boolean(questionText));
    if (!isTextMode && !req.file) {
        return res.status(400).json({ error: 'Question image or question text is required' });
    }
    if (isTextMode && !questionText?.trim()) {
        return res.status(400).json({ error: 'Question text statement is required' });
    }

    const parsedMarks = Math.max(1, parseInt(marks) || 1);
    const questions = getQuestions(subject);
    const newQ = {
        id: 'Q_' + token().slice(0, 12),
        type: isTextMode ? 'text' : 'image',
        text: (questionText || '').trim(),
        options: isTextMode ? {
            A: (optionA || '').trim(),
            B: (optionB || '').trim(),
            C: (optionC || '').trim(),
            D: (optionD || '').trim()
        } : null,
        image: req.file ? ('/uploads/questions/' + req.file.filename) : null,
        correct: correctOption.toUpperCase(),
        marks: parsedMarks,
        createdAt: new Date().toISOString()
    };
    questions.push(newQ);
    writeJSON(questionFile(subject), questions);
    res.json({ success: true, question: newQ });
});
app.post('/api/update-question-marks', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject, id, marks } = req.body;
    if (!validSubject(subject) || !id) return res.status(400).json({ error: 'Valid subject and question ID required' });
    const parsedMarks = Math.max(1, parseInt(marks) || 1);
    const questions = getQuestions(subject);
    const target = questions.find(q => q.id === id);
    if (!target) return res.status(404).json({ error: 'Question not found' });
    target.marks = parsedMarks;
    writeJSON(questionFile(subject), questions);
    res.json({ success: true, id, marks: parsedMarks });
});
app.get('/api/get-questions', (req, res) => {
    const subject = req.query.subject;
    if (!validSubject(subject)) return res.status(400).json({ error: 'Valid subject required' });
    const user = currentStaff(req), participant = currentStudent(req);
    if (!user && (!participant || participant.subject !== subject || !activeExam(subject)))
        return res.status(403).json({ error: 'Paper unavailable' });
    if (user && user.role === 'FACULTY' && user.subject !== subject)
        return res.status(403).json({ error: 'This is not your subject' });
    res.json(getQuestions(subject).map((q, index) => ({
        id: q.id,
        index,
        type: q.type || (q.text ? 'text' : 'image'),
        text: q.text || '',
        options: q.options || null,
        image: q.image || '',
        marks: q.marks !== undefined ? Number(q.marks) : 1,
        ...(user ? { correct: q.correct } : {})
    })));
});
app.post('/api/delete-question', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject, id } = req.body;
    if (!validSubject(subject)) return res.sendStatus(400);
    writeJSON(questionFile(subject), getQuestions(subject).filter(q => q.id !== id));
    res.json({ success: true });
});

app.post('/api/join', (req, res) => {
    const rawRoll = String(req.body.rollNo || '').trim();
    const rawSub = String(req.body.subject || '').trim();
    const rawName = String(req.body.name || '').trim();
    const { className, division, dept, regNo, collegeId } = req.body;

    let cleanSub = rawSub;
    const knownSubs = ['DSA', 'AI', 'DBMS', 'Web Technology'];
    const matched = knownSubs.find(s => s.toLowerCase() === rawSub.toLowerCase());
    if (matched) cleanSub = matched;

    if (!rawRoll || !cleanSub || !rawName || !/^[A-Za-z0-9_ .\/-]{1,64}$/.test(rawRoll) || !validSubject(cleanSub))
        return res.status(400).json({ error: 'Valid name, roll number and subject required' });

    const key = token();
    const participant = {
        roll: rawRoll,
        subject: cleanSub,
        name: rawName,
        className: String(className || 'SY').trim(),
        division: String(division || 'A').trim(),
        dept: String(dept || 'Computer Engineering').trim(),
        regNo: String(regNo || rawRoll).trim(),
        collegeId: String(collegeId || rawRoll).trim(),
        status: activeExam(cleanSub) ? 'in_exam' : 'waiting',
        expires: Date.now() + SESSION_MS
    };
    studentSessions.set(key, participant);
    activeStudents.set(cleanSub + ':' + rawRoll.toUpperCase(), participant);
    setCookie(res, 'student_session', key, SESSION_MS);

    const examDef = getExamsList().find(e => e.subject.toUpperCase() === cleanSub.toUpperCase());
    res.json({
        success: true,
        examActive: !!activeExam(cleanSub),
        deadline: activeExam(cleanSub)?.deadline || null,
        exam: examDef ? {
            title: examDef.title,
            subject: examDef.subject,
            className: examDef.className,
            division: examDef.division,
            examDate: examDef.examDate,
            startTime: examDef.startTime,
            duration: examDef.duration,
            totalMarks: examDef.totalMarks,
            instructions: examDef.instructions,
            status: activeExam(cleanSub) ? 'Live' : examDef.status
        } : {
            title: `${cleanSub} In-Semester Examination`,
            subject: cleanSub,
            className: 'SY-AIML',
            division: 'ALL',
            duration: 60,
            totalMarks: 20,
            instructions: '1. All questions compulsory.\n2. Do not switch tabs or exit fullscreen.\n3. Keep face centered within mobile camera viewport.',
            status: activeExam(cleanSub) ? 'Live' : 'Scheduled'
        }
    });
});
app.get('/api/check-status', (req, res) => {
    const participant = currentStudent(req);
    const sub = (participant && participant.subject) || req.query.subject;
    if (!sub) return res.json({ active: !!globalExam && globalExam.active && Date.now() < globalExam.deadline });
    const exam = activeExam(sub);
    const examDef = getExamsList().find(e => e.subject.toUpperCase() === sub.toUpperCase());
    res.json({
        active: !!exam,
        deadline: exam?.deadline || null,
        subject: sub,
        examTitle: examDef ? examDef.title : `${sub} Examination`,
        status: exam ? 'Live' : (examDef ? examDef.status : 'Scheduled')
    });
});
app.get('/api/exam-statuses', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => {
    const subjects = ['DSA', 'AI', 'DBMS', 'Web Technology'];
    const users = readJSON(usersFile, []);
    users.filter(u => u.subject).forEach(u => { if (!subjects.includes(u.subject)) subjects.push(u.subject); });
    const statuses = {};
    const exams = getExamsList();

    subjects.forEach(sub => {
        const ex = activeExam(sub);
        const waiting = [...activeStudents.values()].filter(s => s.subject === sub && s.status === 'waiting').length;
        const inExam = [...activeStudents.values()].filter(s => s.subject === sub && s.status === 'in_exam').length;
        const examDef = exams.find(e => e.subject.toUpperCase() === sub.toUpperCase());
        statuses[sub] = {
            active: !!ex,
            deadline: ex?.deadline || null,
            remainingMinutes: ex ? Math.max(0, Math.ceil((ex.deadline - Date.now()) / 60000)) : 0,
            waiting,
            inExam,
            status: ex ? 'Live' : (examDef ? examDef.status : 'Scheduled'),
            title: examDef ? examDef.title : `${sub} Examination`
        };
    });
    res.json({
        globalActive: !!globalExam && globalExam.active && Date.now() < globalExam.deadline,
        subjects: statuses
    });
});
app.post('/api/start-exam', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject, all } = req.body;
    if (all && req.staff.role === 'HOD') {
        const subjects = ['DSA', 'AI', 'DBMS', 'Web Technology'];
        const exam = { id: token(), active: true, deadline: Date.now() + EXAM_MS };
        globalExam = exam;
        subjects.forEach(sub => subjectExamStatus.set(sub, { ...exam, id: token() }));
        savePersistentExams();

        const allExams = getExamsList();
        allExams.forEach(e => { e.status = 'Live'; e.releasedAt = new Date().toISOString(); });
        writeJSON(examsFile, allExams);
        logAudit(req.staff.id, req.staff.name, 'ALL_EXAMS_RELEASED', 'Released all college subject examinations');
        return res.json({ success: true, active: true, all: true, deadline: exam.deadline });
    }
    if (subject && !validSubject(subject)) return res.sendStatus(400);
    if (!subject && req.staff.role !== 'HOD') return res.sendStatus(403);
    const exam = { id: token(), active: true, deadline: Date.now() + EXAM_MS };
    if (subject) {
        subjectExamStatus.set(subject, exam);
        const allExams = getExamsList();
        const found = allExams.find(e => e.subject.toUpperCase() === subject.toUpperCase());
        if (found) {
            found.status = 'Live';
            found.releasedAt = new Date().toISOString();
            writeJSON(examsFile, allExams);
        }
        logAudit(req.staff.id, req.staff.name, 'EXAM_RELEASED', `Released examination hall for ${subject}`);
    } else {
        globalExam = exam;
    }
    savePersistentExams();
    res.json({ success: true, active: true, subject, deadline: exam.deadline });
});
app.post('/api/stop-exam', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject, all } = req.body;
    if (all && req.staff.role === 'HOD') {
        globalExam = null;
        subjectExamStatus.clear();
        savePersistentExams();

        const allExams = getExamsList();
        allExams.forEach(e => { e.status = 'Completed'; e.completedAt = new Date().toISOString(); });
        writeJSON(examsFile, allExams);
        logAudit(req.staff.id, req.staff.name, 'ALL_EXAMS_STOPPED', 'Stopped and locked all college examinations');
        return res.json({ success: true, active: false, all: true });
    }
    if (subject && !validSubject(subject)) return res.sendStatus(400);
    if (!subject && req.staff.role !== 'HOD') return res.sendStatus(403);
    if (subject) {
        subjectExamStatus.set(subject, { active: false });
        const allExams = getExamsList();
        const found = allExams.find(e => e.subject.toUpperCase() === subject.toUpperCase());
        if (found) {
            found.status = 'Completed';
            found.completedAt = new Date().toISOString();
            writeJSON(examsFile, allExams);
        }
        logAudit(req.staff.id, req.staff.name, 'EXAM_STOPPED', `Locked / completed examination hall for ${subject}`);
    } else {
        globalExam = null;
    }
    savePersistentExams();
    res.json({ success: true, active: false, subject });
});

// ============ EXAM LIFECYCLE & ANSWER AUTO-SAVE APIS ============
app.get('/api/exams', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => {
    const all = getExamsList();
    const settings = readJSON(settingsFile, {});

    const enriched = all.map(ex => {
        const live = activeExam(ex.subject);
        const questions = getQuestions(ex.subject);
        const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);
        let status = ex.status;
        if (live) status = 'Live';
        else if (status === 'Live' && !live) status = 'Completed';
        if (settings.subjectMarks?.[ex.subject]) status = 'Result Published';

        return {
            ...ex,
            totalMarks: totalMarks || ex.totalMarks || 20,
            questionCount: questions.length,
            status,
            active: !!live
        };
    });

    if (req.staff.role === 'FACULTY' && req.staff.subject) {
        return res.json(enriched.filter(e => e.subject.toUpperCase() === req.staff.subject.toUpperCase()));
    }
    res.json(enriched);
});

app.post('/api/save-exam', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { id, title, subject, className, division, examDate, startTime, duration, instructions, totalMarks } = req.body;
    if (!validSubject(subject)) return res.status(400).json({ error: 'Valid subject required' });

    const exams = getExamsList();
    let exam = exams.find(e => (id && e.id === id) || e.subject.toUpperCase() === subject.toUpperCase());

    if (!exam) {
        exam = {
            id: id || `EXAM_${subject.toUpperCase()}_${Date.now()}`,
            subject,
            createdAt: new Date().toISOString(),
            status: 'Scheduled',
            showResults: false
        };
        exams.push(exam);
    }

    exam.title = String(title || `${subject} Examination`).slice(0, 150);
    exam.className = String(className || 'SY-AIML').slice(0, 50);
    exam.division = String(division || 'ALL').slice(0, 20);
    exam.examDate = String(examDate || new Date().toISOString().split('T')[0]).slice(0, 20);
    exam.startTime = String(startTime || '10:00').slice(0, 10);
    exam.duration = Math.max(10, Math.min(240, Number(duration) || 60));
    exam.instructions = String(instructions || '1. All questions compulsory.\n2. Do not switch tabs.').slice(0, 2000);
    if (totalMarks) exam.totalMarks = Number(totalMarks);

    writeJSON(examsFile, exams);
    logAudit(req.staff.id, req.staff.name, 'EXAM_CONFIGURED', `Configured exam parameters for ${subject}`);
    res.json({ success: true, exam });
});

app.post('/api/publish-exam-results', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject, publish } = req.body;
    if (!validSubject(subject)) return res.sendStatus(400);

    const isPublish = publish !== false;
    const settings = readJSON(settingsFile, {});
    settings.subjectMarks = settings.subjectMarks || {};
    settings.subjectMarks[subject] = isPublish;
    writeJSON(settingsFile, settings);

    const exams = getExamsList();
    const exam = exams.find(e => e.subject.toUpperCase() === subject.toUpperCase());
    if (exam) {
        exam.status = isPublish ? 'Result Published' : 'Completed';
        exam.showResults = isPublish;
        writeJSON(examsFile, exams);
    }

    logAudit(req.staff.id, req.staff.name, isPublish ? 'RESULTS_PUBLISHED' : 'RESULTS_UNPUBLISHED', `${isPublish ? 'Published' : 'Concealed'} candidate results for ${subject}`);
    res.json({ success: true, subject, published: isPublish });
});

app.post('/api/save-answer', student, (req, res) => {
    const s = req.student;
    const key = `${s.subject}:${s.roll.toUpperCase()}`;
    const { questionIndex, questionId, answer, markForReview } = req.body;
    let draft = studentDraftAnswers.get(key) || { answers: {}, markedReview: {} };

    if (questionIndex !== undefined) {
        if (answer !== undefined) draft.answers[questionIndex] = answer;
        if (markForReview !== undefined) draft.markedReview[questionIndex] = !!markForReview;
    }
    if (questionId) {
        if (answer !== undefined) draft.answers[questionId] = answer;
        if (markForReview !== undefined) draft.markedReview[questionId] = !!markForReview;
    }
    draft.lastSaved = Date.now();
    studentDraftAnswers.set(key, draft);

    const live = studentLiveState.get(key);
    if (live) {
        live.answersCount = Object.keys(draft.answers).length;
        if (questionIndex !== undefined) live.currentQuestion = Number(questionIndex);
    }

    res.json({ success: true, savedAt: draft.lastSaved, answersCount: Object.keys(draft.answers).length });
});

app.get('/api/get-draft-answers', student, (req, res) => {
    const s = req.student;
    const key = `${s.subject}:${s.roll.toUpperCase()}`;
    const draft = studentDraftAnswers.get(key) || { answers: {}, markedReview: {} };
    res.json({ success: true, answers: draft.answers, markedReview: draft.markedReview, lastSaved: draft.lastSaved || null });
});

app.get('/api/audit-logs', staff('HOD'), (req, res) => {
    res.json(readJSON(auditLogsFile, []));
});

app.get('/api/student-proctoring-timeline', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => {
    const roll = String(req.query.rollNo || '').trim().toUpperCase();
    const subject = String(req.query.subject || '').trim().toUpperCase();
    if (!roll) return res.status(400).json({ error: 'Roll number required' });

    const logs = readJSON(cheatLogsFile, []);
    const studentLogs = logs.filter(l => {
        const matchesRoll = (l.rollNo || '').toUpperCase() === roll;
        const matchesSub = !subject || (l.subject || '').toUpperCase() === subject;
        return matchesRoll && matchesSub;
    }).map(l => ({
        id: l.id || token().slice(0, 8),
        timestamp: l.timestamp || l.time,
        timeFormatted: l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : (l.time || '—'),
        eventType: l.eventType || (l.reason ? l.reason.toUpperCase().replace(/\s+/g, '_') : 'PROCTORING_ALERT'),
        severity: l.severity || (l.reason && l.reason.includes('strike') ? 'HIGH' : 'MEDIUM'),
        description: l.description || l.reason || l.message || 'Proctoring violation or movement logged',
        snapshot: l.snapshot || l.file || null
    }));

    studentLogs.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    res.json({ rollNo: roll, subject, timeline: studentLogs });
});

app.post('/api/log-proctoring-event', student, (req, res) => {
    const s = req.student;
    const { eventType, severity, description } = req.body;
    const logs = readJSON(cheatLogsFile, []);
    const entry = {
        id: token().slice(0, 10),
        rollNo: s.roll,
        name: s.name,
        subject: s.subject,
        eventType: String(eventType || 'PROCTORING_EVENT').slice(0, 50),
        severity: String(severity || 'LOW').slice(0, 20),
        description: String(description || 'Proctoring variance').slice(0, 200),
        timestamp: new Date().toISOString(),
        time: new Date().toLocaleTimeString()
    };
    logs.unshift(entry);
    if (logs.length > 1000) logs.length = 1000;
    writeJSON(cheatLogsFile, logs);
    res.json({ success: true, eventId: entry.id });
});
app.get('/api/waiting-students', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), ownSubject, (req, res) => {
    const subject = req.query.subject;
    const students = [...activeStudents.values()].filter(s => !subject || s.subject === subject);
    const live = subject && activeExam(subject);
    res.json({ total: students.length, waiting: students.filter(s => s.status === 'waiting').length,
        in_exam: students.filter(s => s.status === 'in_exam').length, isExamActive: !!live, students });
});
app.post('/api/submit-exam', student, (req, res) => {
    const s = req.student;
    if (req.body.rollNo !== s.roll || req.body.subject !== s.subject) return res.sendStatus(403);
    const exam = activeExam(s.subject);
    if (!exam) return res.status(403).json({ error: 'Exam is not active or time has expired' });
    const submissions = readJSON(submissionsFile);
    if (submissions.some(row => row.rollNo === s.roll && row.subject === s.subject && row.examId === exam.id))
        return res.status(409).json({ error: 'This exam has already been submitted' });
    const questions = getQuestions(s.subject);
    const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);
    const score = questions.reduce((sum, q, i) => {
        const isCorrect = String(answers[i] || answers[q.id] || '').toUpperCase() === q.correct;
        return sum + (isCorrect ? (Number(q.marks) || 1) : 0);
    }, 0);
    const submission = { collegeId: s.collegeId, rollNo: s.roll, name: s.name, subject: s.subject,
        examId: exam.id, score: `${score}/${totalMarks}`, rawScore: score, total: totalMarks,
        answers, time: new Date().toISOString() };
    submissions.unshift(submission);
    writeJSON(submissionsFile, submissions);
    s.status = 'submitted';
    const settings = readJSON(settingsFile, {});
    const sub = s.subject;
    const roll = (s.roll || '').toUpperCase();
    const indSetting = settings.individualStudentMarks?.[sub]?.[roll];
    const showMarks = indSetting !== undefined ? indSetting : (Boolean(settings.showMarks) && settings.subjectMarks?.[sub] !== false);
    res.json({ success: true, submission: showMarks ? submission : { rollNo: s.roll, time: submission.time } });
});
app.get('/api/get-settings', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => res.json(readJSON(settingsFile, {})));
app.post('/api/update-settings', staff('HOD', 'FACULTY'), (req, res) => {
    if (req.staff.role === 'FACULTY' && req.body.subject && req.body.subject !== req.staff.subject) return res.sendStatus(403);
    const current = readJSON(settingsFile, {});
    current.subjectMarks = current.subjectMarks || {};
    current.individualStudentMarks = current.individualStudentMarks || {};

    if (req.staff.role === 'HOD') {
        if (req.body.showMarks !== undefined) current.showMarks = !!req.body.showMarks;
    } else {
        const sub = req.staff.subject;
        if (req.body.showMarks !== undefined) {
            current.subjectMarks[sub] = !!req.body.showMarks;
        }
        if (req.body.studentRoll) {
            current.individualStudentMarks[sub] = current.individualStudentMarks[sub] || {};
            current.individualStudentMarks[sub][req.body.studentRoll.toUpperCase()] = !!req.body.individualShow;
        }
    }
    writeJSON(settingsFile, current);
    res.json({ success: true, settings: current });
});
app.get('/api/get-submissions', staff('HOD', 'CLASS_TEACHER', 'FACULTY'), ownSubject, (req, res) => {
    const all = readJSON(submissionsFile, []);
    const filtered = req.query.subject ? all.filter(s => s.subject === req.query.subject) : all;
    
    const persistentLogs = readJSON(cheatLogsFile, []);
    let snapshotDirs = [];
    try {
        if (fs.existsSync(snapshotsDir)) snapshotDirs = fs.readdirSync(snapshotsDir);
    } catch(e) {}

    const enriched = filtered.map(sub => {
        const rollUpper = (sub.rollNo || '').toUpperCase();
        let snaps = 0;
        snapshotDirs.forEach(dir => {
            if (dir.toUpperCase().includes(rollUpper)) {
                try {
                    const fullP = path.join(snapshotsDir, dir);
                    if (fs.statSync(fullP).isDirectory()) {
                        snaps += fs.readdirSync(fullP).filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png')).length;
                    }
                } catch(e) {}
            }
        });
        const vLogs = persistentLogs.filter(l => l.rollNo && l.rollNo.toUpperCase() === rollUpper);
        return {
            ...sub,
            snapshotCount: snaps,
            violationCount: vLogs.length,
            hasViolations: (snaps > 0 || vLogs.length > 0)
        };
    });

    res.json(enriched);
});

app.post('/api/edit-student-marks', staff('HOD', 'FACULTY'), (req, res) => {
    const { rollNo, subject, rawScore, total, reason } = req.body;
    const roll = String(rollNo || '').trim().toUpperCase();
    const sub = String(subject || '').trim();
    if (!roll || !sub) return res.status(400).json({ error: 'Roll number and subject are required' });

    if (req.staff.role === 'FACULTY' && req.staff.subject !== sub) {
        return res.status(403).json({ error: 'You are only authorized to edit marks for your assigned subject (' + req.staff.subject + ')' });
    }

    const parsedScore = Number(rawScore);
    const parsedTotal = Number(total) || 20;
    if (isNaN(parsedScore) || parsedScore < 0 || parsedScore > parsedTotal) {
        return res.status(400).json({ error: `Score must be a number between 0 and ${parsedTotal}` });
    }

    const submissions = readJSON(submissionsFile, []);
    let target = submissions.find(s => s.rollNo && s.rollNo.toUpperCase() === roll && s.subject && s.subject.toUpperCase() === sub.toUpperCase());

    const students = readJSON(studentsFile, []);
    const studentObj = students.find(s => s.rollNo && s.rollNo.toUpperCase() === roll);
    const studentName = studentObj ? studentObj.name : (target ? target.name : 'Student ' + roll);

    const overrideEntry = {
        rawScore: parsedScore,
        total: parsedTotal,
        score: `${parsedScore}/${parsedTotal}`,
        isOverridden: true,
        overrideReason: String(reason || 'Mark adjustment by faculty').trim(),
        overriddenBy: req.staff.name || req.staff.id,
        overriddenAt: new Date().toISOString()
    };

    if (target) {
        Object.assign(target, overrideEntry);
    } else {
        target = {
            collegeId: studentObj?.collegeId || roll,
            rollNo: roll,
            name: studentName,
            subject: sub,
            examId: 'MANUAL_OVERRIDE_' + Date.now(),
            answers: {},
            ...overrideEntry,
            time: new Date().toISOString()
        };
        submissions.unshift(target);
    }

    writeJSON(submissionsFile, submissions);
    res.json({ success: true, submission: target, message: `Marks for ${roll} in ${sub} updated to ${target.score}` });
});
app.post('/api/log-cheat', student, (req, res) => {
    const reason = String(req.body.reason || 'Unusual activity detected').slice(0, 150);
    const strike = Number(req.body.strike) || 1;
    const entry = {
        id: token().slice(0, 10),
        rollNo: req.student.roll,
        subject: req.student.subject,
        reason,
        strike,
        time: new Date().toISOString()
    };
    logs.unshift(entry);
    const persistentLogs = readJSON(cheatLogsFile, []);
    persistentLogs.unshift(entry);
    writeJSON(cheatLogsFile, persistentLogs);
    res.sendStatus(200);
});

app.post('/api/upload-snapshot', student, (req, res) => {
    const image = req.body.image;
    if (typeof image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))
        return res.sendStatus(400);
    const folder = req.student ? `${req.student.subject}_${req.student.roll}` : String(req.body.studentId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(snapshotsDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const filename = Date.now() + '.jpg';
    fs.writeFile(path.join(dir, filename), image.split(',')[1], 'base64', () => {
        if (req.body.reason) {
            const entry = {
                id: token().slice(0, 10),
                rollNo: req.student?.roll || req.body.rollNo,
                subject: req.student?.subject || req.body.subject,
                reason: String(req.body.reason).slice(0, 150),
                strike: Number(req.body.strike) || 1,
                snapshot: filename,
                folder,
                time: new Date().toISOString()
            };
            logs.unshift(entry);
            const persistentLogs = readJSON(cheatLogsFile, []);
            persistentLogs.unshift(entry);
            writeJSON(cheatLogsFile, persistentLogs);
        }
        res.sendStatus(200);
    });
});

app.get('/api/student-snapshots', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => {
    const roll = String(req.query.rollNo || '').trim().toUpperCase();
    if (!roll) return res.status(400).json({ error: 'Roll number required' });
    const targetSubject = String(req.query.subject || (req.staff.role === 'FACULTY' ? req.staff.subject : '')).trim().toUpperCase();

    const snapshots = [];
    try {
        const allDirs = fs.readdirSync(snapshotsDir);
        for (const dir of allDirs) {
            const upper = dir.toUpperCase();
            if (upper.includes(roll)) {
                let detectedSub = '';
                const known = ['DSA', 'AI', 'DBMS', 'Web Technology'];
                for (const k of known) {
                    if (upper.includes(k.toUpperCase())) {
                        detectedSub = k;
                        break;
                    }
                }
                const fullFolderPath = path.join(snapshotsDir, dir);
                if (fs.statSync(fullFolderPath).isDirectory()) {
                    const files = fs.readdirSync(fullFolderPath).filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'));
                    files.sort().reverse();
                    files.forEach(f => {
                        const stat = fs.statSync(path.join(fullFolderPath, f));
                        snapshots.push({
                            folder: dir,
                            filename: f,
                            subject: detectedSub || targetSubject || 'Surveillance',
                            isTargetSubject: !!(targetSubject && detectedSub && detectedSub.toUpperCase() === targetSubject),
                            url: `/api/snapshot-image?folder=${encodeURIComponent(dir)}&file=${encodeURIComponent(f)}`,
                            time: stat.mtime.toISOString(),
                            size: stat.size
                        });
                    });
                }
            }
        }
    } catch(e) {}

    // Sort to prioritize requested subject, then newest first
    snapshots.sort((a, b) => {
        if (a.isTargetSubject && !b.isTargetSubject) return -1;
        if (!a.isTargetSubject && b.isTargetSubject) return 1;
        return new Date(b.time) - new Date(a.time);
    });

    const persistentLogs = readJSON(cheatLogsFile, []);
    const studentLogs = persistentLogs.filter(l => l.rollNo && l.rollNo.toUpperCase() === roll);

    res.json({
        rollNo: roll,
        subject: targetSubject || null,
        snapshots,
        logs: studentLogs,
        total: snapshots.length,
        violations: studentLogs.length
    });
});

app.get('/api/snapshot-image', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => {
    const folder = path.basename(String(req.query.folder || ''));
    const file = path.basename(String(req.query.file || ''));
    if (!folder || !file) return res.sendStatus(400);
    const target = path.join(snapshotsDir, folder, file);
    if (!fs.existsSync(target)) return res.sendStatus(404);
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(target);
});

// ============ LIVE INVIGILATION & REMOTE WARNING SYSTEM ============
app.post('/api/student-heartbeat', student, (req, res) => {
    const s = req.student;
    const key = `${s.subject}:${s.roll.toUpperCase()}`;
    const faceStatus = String(req.body.faceStatus || 'centered').slice(0, 50);
    const currentQuestion = Number(req.body.currentQuestion) || 0;
    const answersCount = Number(req.body.answersCount) || 0;
    const strikes = Number(req.body.strikes) || 0;

    studentLiveState.set(key, {
        rollNo: s.roll,
        subject: s.subject,
        name: s.name,
        division: s.division || 'A',
        className: s.className || 'SY-AIML',
        faceStatus,
        currentQuestion,
        answersCount,
        strikes,
        lastSeen: Date.now()
    });

    const warning = studentWarnings.get(key);
    const forceSubmit = studentForceSubmits.has(key);
    const exam = activeExam(s.subject);

    res.json({
        success: true,
        active: !!exam,
        deadline: exam?.deadline || null,
        pendingWarning: warning && !warning.acknowledged ? warning.message : null,
        warningTime: warning ? warning.time : null,
        warningSentBy: warning ? warning.sentBy : null,
        forceSubmit
    });
});

app.post('/api/acknowledge-warning', student, (req, res) => {
    const key = `${req.student.subject}:${req.student.roll.toUpperCase()}`;
    const warning = studentWarnings.get(key);
    if (warning) {
        warning.acknowledged = true;
        warning.acknowledgedAt = new Date().toISOString();
    }
    res.json({ success: true });
});

app.post('/api/send-student-warning', staff('HOD', 'FACULTY'), (req, res) => {
    const { rollNo, subject, message } = req.body;
    const roll = String(rollNo || '').trim().toUpperCase();
    const sub = String(subject || '').trim();
    const msg = String(message || 'Please remain focused and face the screen.').trim();

    if (!roll || !sub) return res.status(400).json({ error: 'Roll number and subject required' });
    if (req.staff.role === 'FACULTY' && req.staff.subject !== sub) {
        return res.status(403).json({ error: 'You can only send warnings for your assigned subject' });
    }

    const key = `${sub}:${roll}`;
    const warningObj = {
        message: msg,
        time: new Date().toISOString(),
        sentBy: req.staff.name || req.staff.id,
        acknowledged: false
    };
    studentWarnings.set(key, warningObj);

    // Record in persistent cheat logs as an official caution
    const entry = {
        id: 'warn_' + token().slice(0, 8),
        rollNo: roll,
        subject: sub,
        reason: `Invigilator Warning: "${msg}" (Sent by ${warningObj.sentBy})`,
        strike: 0,
        warning: true,
        time: new Date().toISOString()
    };
    logs.unshift(entry);
    const persistentLogs = readJSON(cheatLogsFile, []);
    persistentLogs.unshift(entry);
    writeJSON(cheatLogsFile, persistentLogs);

    res.json({ success: true, message: `Warning dispatched to ${roll}` });
});

app.post('/api/broadcast-warning', staff('HOD', 'FACULTY'), (req, res) => {
    const { subject, message } = req.body;
    const sub = String(subject || '').trim();
    const msg = String(message || 'Attention all candidates: Maintain exam discipline and keep your camera active.').trim();

    if (!sub) return res.status(400).json({ error: 'Subject required' });
    if (req.staff.role === 'FACULTY' && req.staff.subject !== sub) {
        return res.status(403).json({ error: 'You can only broadcast for your assigned subject' });
    }

    let count = 0;
    for (const [key, st] of activeStudents.entries()) {
        if (st.subject === sub) {
            studentWarnings.set(`${sub}:${st.roll.toUpperCase()}`, {
                message: msg,
                time: new Date().toISOString(),
                sentBy: req.staff.name || req.staff.id,
                acknowledged: false
            });
            count++;
        }
    }

    res.json({ success: true, count, message: `Broadcast sent to ${count} active candidates in ${sub}` });
});

app.post('/api/force-submit-student', staff('HOD', 'FACULTY'), (req, res) => {
    const { rollNo, subject, reason } = req.body;
    const roll = String(rollNo || '').trim().toUpperCase();
    const sub = String(subject || '').trim();
    if (!roll || !sub) return res.status(400).json({ error: 'Roll number and subject required' });
    if (req.staff.role === 'FACULTY' && req.staff.subject !== sub) {
        return res.status(403).json({ error: 'You can only terminate exams for your assigned subject' });
    }

    const key = `${sub}:${roll}`;
    studentForceSubmits.add(key);

    const entry = {
        id: 'term_' + token().slice(0, 8),
        rollNo: roll,
        subject: sub,
        reason: `Exam Terminated by Invigilator (${req.staff.name || req.staff.id}): ${reason || 'Cheating violation'}`,
        strike: 3,
        time: new Date().toISOString()
    };
    logs.unshift(entry);
    const persistentLogs = readJSON(cheatLogsFile, []);
    persistentLogs.unshift(entry);
    writeJSON(cheatLogsFile, persistentLogs);

    res.json({ success: true, message: `Termination command sent for ${roll}` });
});

app.get('/api/live-invigilation', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => {
    const sub = String(req.query.subject || (req.staff.role === 'FACULTY' ? req.staff.subject : 'DSA')).trim();
    const divFilter = String(req.query.division || '').trim().toUpperCase();

    const submissions = readJSON(submissionsFile, []);
    const persistentLogs = readJSON(cheatLogsFile, []);

    let snapshotDirs = [];
    try {
        if (fs.existsSync(snapshotsDir)) snapshotDirs = fs.readdirSync(snapshotsDir);
    } catch(e) {}

    const candidates = [];
    const now = Date.now();
    const processedRolls = new Set();

    for (const [key, part] of activeStudents.entries()) {
        if (!sub || part.subject.toUpperCase() === sub.toUpperCase()) {
            const rollUpper = part.roll.toUpperCase();
            if (divFilter && divFilter !== 'ALL' && (part.division || '').toUpperCase() !== divFilter) continue;
            processedRolls.add(rollUpper);

            const liveKey = `${part.subject}:${rollUpper}`;
            const live = studentLiveState.get(liveKey);
            const isOnline = live ? (now - live.lastSeen < 15000) : false;
            const subRec = submissions.find(s => s.rollNo && s.rollNo.toUpperCase() === rollUpper && s.subject.toUpperCase() === part.subject.toUpperCase());
            const warning = studentWarnings.get(liveKey);
            const vLogs = persistentLogs.filter(l => l.rollNo && l.rollNo.toUpperCase() === rollUpper && l.subject && l.subject.toUpperCase() === part.subject.toUpperCase());

            let latestSnapshotUrl = null;
            let totalSnapshots = 0;
            snapshotDirs.forEach(dir => {
                if (dir.toUpperCase().includes(rollUpper)) {
                    try {
                        const fullP = path.join(snapshotsDir, dir);
                        if (fs.statSync(fullP).isDirectory()) {
                            const files = fs.readdirSync(fullP).filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png')).sort().reverse();
                            totalSnapshots += files.length;
                            if (!latestSnapshotUrl && files.length) {
                                latestSnapshotUrl = `/api/snapshot-image?folder=${encodeURIComponent(dir)}&file=${encodeURIComponent(files[0])}`;
                            }
                        }
                    } catch(e) {}
                }
            });

            const strikeCount = vLogs.reduce((max, l) => Math.max(max, l.strike || 0), 0);
            let stateCategory = 'focused';
            if (subRec) {
                stateCategory = 'submitted';
            } else if (!isOnline) {
                stateCategory = 'offline';
            } else if (strikeCount >= 1 || (live && live.faceStatus && live.faceStatus.includes('violation'))) {
                stateCategory = 'violation';
            } else if (live && live.faceStatus && (live.faceStatus.includes('turned') || live.faceStatus.includes('distracted') || live.faceStatus.includes('multiple'))) {
                stateCategory = 'warning';
            }

            candidates.push({
                rollNo: part.roll,
                name: part.name,
                division: part.division || 'A',
                className: part.className || 'SY-AIML',
                subject: part.subject,
                status: subRec ? 'submitted' : (isOnline ? 'in_exam' : 'disconnected'),
                stateCategory,
                faceStatus: live ? live.faceStatus : (subRec ? 'Submitted' : 'Offline'),
                currentQuestion: live ? live.currentQuestion : 0,
                answersCount: live ? live.answersCount : (subRec && subRec.answers ? Object.keys(subRec.answers).length : 0),
                isOnline,
                lastSeen: live ? live.lastSeen : null,
                latestSnapshotUrl,
                totalSnapshots,
                strikeCount,
                violationsCount: vLogs.length,
                pendingWarning: warning && !warning.acknowledged ? warning.message : null,
                isWarningAcknowledged: warning ? warning.acknowledged : false,
                isTerminated: studentForceSubmits.has(liveKey),
                submissionScore: subRec ? subRec.score : null
            });
        }
    }

    const categoryOrder = { violation: 0, warning: 1, focused: 2, submitted: 3, offline: 4 };
    candidates.sort((a, b) => (categoryOrder[a.stateCategory] ?? 5) - (categoryOrder[b.stateCategory] ?? 5));

    res.json({
        success: true,
        subject: sub,
        total: candidates.length,
        stats: {
            total: candidates.length,
            inExam: candidates.filter(c => c.isOnline && c.status !== 'submitted').length,
            focused: candidates.filter(c => c.stateCategory === 'focused').length,
            warning: candidates.filter(c => c.stateCategory === 'warning').length,
            violation: candidates.filter(c => c.stateCategory === 'violation').length,
            submitted: candidates.filter(c => c.status === 'submitted').length
        },
        candidates
    });
});

// ============ ONE-CLICK EXCEL MARKSHEET EXPORT ============
app.get('/api/export-marks-excel', staff('HOD', 'CLASS_TEACHER', 'FACULTY'), (req, res) => {
    const sub = String(req.query.subject || (req.staff.role === 'FACULTY' ? req.staff.subject : 'DSA')).trim();
    const divFilter = String(req.query.division || '').trim().toUpperCase();

    const students = readJSON(studentsFile, []);
    const submissions = readJSON(submissionsFile, []);
    const persistentLogs = readJSON(cheatLogsFile, []);

    const filteredStudents = students.filter(s => {
        if (!divFilter || divFilter === 'ALL') return true;
        return (s.division || '').toUpperCase() === divFilter || (s.className || '').toUpperCase().includes(divFilter);
    });

    const rows = [
        ['G. H. RAISONI COLLEGE OF ENGINEERING AND MANAGEMENT, PUNE'],
        ['(An Autonomous Institute Affiliated to Savitribai Phule Pune University)'],
        ['DEPARTMENT OF COMPUTER ENGINEERING & ARTIFICIAL INTELLIGENCE'],
        ['AUTONOMOUS EXAMINATION OFFICIAL MARKSHEET & GAZETTE'],
        [`Subject: ${sub} | Academic Year: 2026-2027 | Division: ${divFilter || 'All Divisions'} | Export Date: ${new Date().toLocaleDateString()}`],
        [],
        [
            'S.No',
            'Roll Number',
            'Candidate Full Name',
            'Class',
            'Division',
            'Department',
            'Subject',
            'Max Marks',
            'Marks Obtained',
            'Percentage (%)',
            'Result Status',
            'Exam Attendance',
            'Proctoring Strikes',
            'Integrity & Audit Remarks',
            'Submission Time'
        ]
    ];

    filteredStudents.forEach((st, idx) => {
        const rollUpper = (st.rollNo || '').toUpperCase();
        const subRec = submissions.find(s => s.rollNo && s.rollNo.toUpperCase() === rollUpper && s.subject.toUpperCase() === sub.toUpperCase());
        const vLogs = persistentLogs.filter(l => l.rollNo && l.rollNo.toUpperCase() === rollUpper && l.subject && l.subject.toUpperCase() === sub.toUpperCase());

        let maxMarks = 20;
        let rawScore = null;
        let pct = null;
        let result = 'ABSENT / PENDING';
        let attendance = 'Absent / Not Given';
        let integrity = 'Clean';
        let subTime = '—';

        if (subRec) {
            maxMarks = subRec.total || 20;
            rawScore = subRec.rawScore !== undefined ? subRec.rawScore : (parseInt(subRec.score) || 0);
            pct = Math.round((rawScore / maxMarks) * 100);
            result = pct >= 40 ? 'PASS' : 'FAIL';
            attendance = 'Present / Submitted';
            if (subRec.isOverridden) {
                integrity = `Overridden by Faculty: ${subRec.overrideReason || ''}`;
            } else if (vLogs.length > 0) {
                integrity = `Infractions Recorded: ${vLogs.length} incident(s)`;
            }
            subTime = subRec.time ? new Date(subRec.time).toLocaleString() : '—';
        }

        rows.push([
            idx + 1,
            st.rollNo,
            st.name,
            st.className || 'SY-AIML',
            st.division || 'A',
            st.dept || 'Computer Engineering & AI',
            sub,
            maxMarks,
            rawScore !== null ? rawScore : '—',
            pct !== null ? `${pct}%` : '—',
            result,
            attendance,
            vLogs.length ? Math.max(...vLogs.map(l => l.strike || 0)) : 0,
            integrity,
            subTime
        ]);
    });

    const ws = xlsx.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 24 },
        { wch: 12 },
        { wch: 10 },
        { wch: 30 },
        { wch: 12 },
        { wch: 12 },
        { wch: 15 },
        { wch: 15 },
        { wch: 14 },
        { wch: 20 },
        { wch: 18 },
        { wch: 35 },
        { wch: 22 }
    ];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Official_Marksheet');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const cleanFilename = `Raisoni_${sub.replace(/[^A-Za-z0-9]/g, '_')}_Marksheet_${divFilter || 'ALL'}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
    res.send(buffer);
});
app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || 'Invalid request' }));
if (require.main === module) app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
module.exports = app;
