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
const EXAM_MS = 120 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const studentSessions = new Map();
const subjectExamStatus = new Map();
const activeStudents = new Map();
const logs = [];
let globalExam = null;

for (const dir of [questionsDir, uploadsDir, snapshotsDir]) fs.mkdirSync(dir, { recursive: true });
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
    res.cookie(name, value, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge, path: '/' });
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
    
    // Discover all available subjects
    const subjectsSet = new Set(['DSA', 'AI', 'DBMS', 'Web Technology']);
    users.filter(u => u.subject).forEach(u => subjectsSet.add(u.subject));
    submissions.forEach(s => subjectsSet.add(s.subject));
    const allKnownSubjects = Array.from(subjectsSet);

    const divFilter = (req.query.division || req.query.className || '').trim().toUpperCase();
    const isCT = req.staff.role === 'CLASS_TEACHER';
    const ctClass = (req.staff.className || '').toUpperCase();

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
        const studentSubs = submissions.filter(sub => sub.rollNo.toUpperCase() === st.rollNo.toUpperCase());
        const givenSubjects = studentSubs.map(s => ({
            subject: s.subject,
            score: s.score,
            rawScore: s.rawScore,
            total: s.total,
            time: s.time
        }));
        const givenSubjectNames = new Set(givenSubjects.map(g => g.subject.toUpperCase()));
        const pendingSubjects = allKnownSubjects.filter(sub => !givenSubjectNames.has(sub.toUpperCase()));

        return {
            ...st,
            hasGivenExam: givenSubjects.length > 0,
            givenCount: givenSubjects.length,
            pendingCount: pendingSubjects.length,
            givenSubjects,
            pendingSubjects
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

app.get('/api/student-all-marks', staff('HOD', 'CLASS_TEACHER'), (req, res) => {
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
                time: sub.time
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
                time: null
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
    const { subject, correctOption, marks } = req.body;
    if (!validSubject(subject) || !req.file || !/^[A-D]$/i.test(correctOption || ''))
        return res.status(400).json({ error: 'Subject, image and correct option A–D required' });
    const parsedMarks = Math.max(1, parseInt(marks) || 1);
    const questions = getQuestions(subject);
    const newQ = {
        id: 'Q_' + token().slice(0, 12),
        image: '/uploads/questions/' + req.file.filename,
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
        image: q.image,
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
    const { rollNo, subject, name, className, division, dept, regNo, collegeId } = req.body;
    if (typeof rollNo !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(rollNo) || !validSubject(subject) || !name)
        return res.status(400).json({ error: 'Valid name, roll number and subject required' });
    const key = token();
    const participant = { roll: rollNo, subject, name, className, division, dept, regNo, collegeId: collegeId || rollNo,
        status: activeExam(subject) ? 'in_exam' : 'waiting', expires: Date.now() + SESSION_MS };
    studentSessions.set(key, participant);
    activeStudents.set(subject + ':' + rollNo, participant);
    setCookie(res, 'student_session', key, SESSION_MS);
    res.json({ success: true, examActive: !!activeExam(subject), deadline: activeExam(subject)?.deadline || null });
});
app.get('/api/check-status', (req, res) => {
    const participant = currentStudent(req);
    const sub = (participant && participant.subject) || req.query.subject;
    if (!sub) return res.json({ active: !!globalExam && globalExam.active && Date.now() < globalExam.deadline });
    const exam = activeExam(sub);
    res.json({ active: !!exam, deadline: exam?.deadline || null, subject: sub });
});
app.get('/api/exam-statuses', staff('HOD', 'FACULTY', 'CLASS_TEACHER'), (req, res) => {
    const subjects = ['DSA', 'AI', 'DBMS', 'Web Technology'];
    const users = readJSON(usersFile, []);
    users.filter(u => u.subject).forEach(u => { if (!subjects.includes(u.subject)) subjects.push(u.subject); });
    const statuses = {};
    subjects.forEach(sub => {
        const ex = activeExam(sub);
        const waiting = [...activeStudents.values()].filter(s => s.subject === sub && s.status === 'waiting').length;
        const inExam = [...activeStudents.values()].filter(s => s.subject === sub && s.status === 'in_exam').length;
        statuses[sub] = {
            active: !!ex,
            deadline: ex?.deadline || null,
            remainingMinutes: ex ? Math.max(0, Math.ceil((ex.deadline - Date.now()) / 60000)) : 0,
            waiting,
            inExam
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
        return res.json({ success: true, active: true, all: true, deadline: exam.deadline });
    }
    if (subject && !validSubject(subject)) return res.sendStatus(400);
    if (!subject && req.staff.role !== 'HOD') return res.sendStatus(403);
    const exam = { id: token(), active: true, deadline: Date.now() + EXAM_MS };
    if (subject) subjectExamStatus.set(subject, exam);
    else globalExam = exam;
    savePersistentExams();
    res.json({ success: true, active: true, subject, deadline: exam.deadline });
});
app.post('/api/stop-exam', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject, all } = req.body;
    if (all && req.staff.role === 'HOD') {
        globalExam = null;
        subjectExamStatus.clear();
        savePersistentExams();
        return res.json({ success: true, active: false, all: true });
    }
    if (subject && !validSubject(subject)) return res.sendStatus(400);
    if (!subject && req.staff.role !== 'HOD') return res.sendStatus(403);
    if (subject) subjectExamStatus.set(subject, { active: false });
    else globalExam = null;
    savePersistentExams();
    res.json({ success: true, active: false, subject });
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
    const all = readJSON(submissionsFile);
    res.json(req.query.subject ? all.filter(s => s.subject === req.query.subject) : all);
});
app.post('/api/log-cheat', student, (req, res) => {
    logs.unshift({ rollNo: req.student.roll, reason: String(req.body.reason || '').slice(0, 150), time: new Date().toISOString() });
    res.sendStatus(200);
});
app.post('/api/upload-snapshot', student, (req, res) => {
    const image = req.body.image;
    if (typeof image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))
        return res.sendStatus(400);
    const dir = path.join(snapshotsDir, req.student.subject + '_' + req.student.roll);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(path.join(dir, Date.now() + '.jpg'), image.split(',')[1], 'base64', () => res.sendStatus(200));
});
app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || 'Invalid request' }));
if (require.main === module) app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
module.exports = app;
