const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const usersFile = path.join(ROOT, 'users.json');
const settingsFile = path.join(ROOT, 'exam_settings.json');
const submissionsFile = path.join(ROOT, 'submissions.json');
const questionsDir = path.join(ROOT, 'questions_by_subject');
const uploadsDir = path.join(ROOT, 'uploads', 'questions');
const snapshotsDir = path.join(ROOT, 'snapshots');
const EXAM_MS = 15 * 60 * 1000;
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
    if (typeof hash !== 'string' || !hash.includes(':')) return false;
    const [salt, hex] = hash.split(':');
    const expected = Buffer.from(hex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function bootstrap() {
    const users = readJSON(usersFile);
    if (!process.env.BOOTSTRAP_HOD_ID || !process.env.BOOTSTRAP_HOD_PASSWORD) return;
    if (process.env.BOOTSTRAP_HOD_PASSWORD.length < 12) throw Error('Bootstrap password must have at least 12 characters');
    const existing = users.find(u => u.id === process.env.BOOTSTRAP_HOD_ID && u.role === 'HOD');
    if (existing?.passwordHash) return;
    if (existing) {
        existing.passwordHash = hashPassword(process.env.BOOTSTRAP_HOD_PASSWORD);
        delete existing.password;
    } else {
        users.push({ id: process.env.BOOTSTRAP_HOD_ID, role: 'HOD', name: 'HOD',
            passwordHash: hashPassword(process.env.BOOTSTRAP_HOD_PASSWORD) });
    }
    writeJSON(usersFile, users);
}
bootstrap();

// Serve only selected browser assets. Data files and snapshots are never public.
app.get(['/', '/staff'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/student', (req, res) => res.sendFile(path.join(ROOT, 'student.html')));
for (const asset of ['campus_scene.css', 'campus_3d.js', 'portal_ui.css']) {
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
    const users = readJSON(usersFile);
    const found = users.find(u => u.id === id && u.role === role);
    if (!found || typeof password !== 'string' || !verifyPassword(password, found.passwordHash))
        return res.status(401).json({ error: 'Invalid credentials or role' });
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

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, token() + (file.mimetype === 'image/png' ? '.png' : '.jpg'))
});
const upload = multer({ storage, limits: { fileSize: 3 * 1024 * 1024 }, fileFilter: (_req, file, cb) =>
    cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype)) });
app.post('/api/upload-question', staff('HOD', 'FACULTY'), upload.single('questionImage'), ownSubject, (req, res) => {
    const { subject, correctOption } = req.body;
    if (!validSubject(subject) || !req.file || !/^[A-D]$/i.test(correctOption || ''))
        return res.status(400).json({ error: 'Subject, image and correct option A–D required' });
    const questions = getQuestions(subject);
    questions.push({ id: 'Q_' + token().slice(0, 12), image: '/uploads/questions/' + req.file.filename,
        correct: correctOption.toUpperCase(), createdAt: new Date().toISOString() });
    writeJSON(questionFile(subject), questions);
    res.json({ success: true });
});
app.get('/api/get-questions', (req, res) => {
    const subject = req.query.subject;
    if (!validSubject(subject)) return res.status(400).json({ error: 'Valid subject required' });
    const user = currentStaff(req), participant = currentStudent(req);
    if (!user && (!participant || participant.subject !== subject || !activeExam(subject)))
        return res.status(403).json({ error: 'Paper unavailable' });
    if (user && user.role === 'FACULTY' && user.subject !== subject)
        return res.status(403).json({ error: 'This is not your subject' });
    res.json(getQuestions(subject).map((q, index) => ({ id: q.id, index, image: q.image })));
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
app.get('/api/check-status', student, (req, res) => {
    const exam = activeExam(req.student.subject);
    res.json({ active: !!exam, deadline: exam?.deadline || null });
});
app.post('/api/start-exam', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject } = req.body;
    if (subject && !validSubject(subject)) return res.sendStatus(400);
    if (!subject && req.staff.role !== 'HOD') return res.sendStatus(403);
    const exam = { id: token(), active: true, deadline: Date.now() + EXAM_MS };
    if (subject) subjectExamStatus.set(subject, exam);
    else globalExam = exam;
    res.json({ success: true, active: true, subject, deadline: exam.deadline });
});
app.post('/api/stop-exam', staff('HOD', 'FACULTY'), ownSubject, (req, res) => {
    const { subject } = req.body;
    if (subject && !validSubject(subject)) return res.sendStatus(400);
    if (!subject && req.staff.role !== 'HOD') return res.sendStatus(403);
    if (subject) subjectExamStatus.set(subject, { active: false });
    else globalExam = null;
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
    const score = questions.reduce((sum, q, i) => sum + (String(answers[i] || answers[q.id] || '').toUpperCase() === q.correct ? 1 : 0), 0);
    const submission = { collegeId: s.collegeId, rollNo: s.roll, name: s.name, subject: s.subject,
        examId: exam.id, score: `${score}/${questions.length}`, rawScore: score, total: questions.length,
        answers, time: new Date().toISOString() };
    submissions.unshift(submission);
    writeJSON(submissionsFile, submissions);
    s.status = 'submitted';
    const settings = readJSON(settingsFile, {});
    const showMarks = settings.showMarks && settings.subjectMarks?.[s.subject] !== false;
    res.json({ success: true, submission: showMarks ? submission : { rollNo: s.roll, time: submission.time } });
});
app.get('/api/get-settings', staff('HOD', 'FACULTY'), (req, res) => res.json(readJSON(settingsFile, {})));
app.post('/api/update-settings', staff('HOD', 'FACULTY'), (req, res) => {
    if (req.staff.role === 'FACULTY' && req.body.subject !== req.staff.subject) return res.sendStatus(403);
    const current = readJSON(settingsFile, {});
    if (req.staff.role === 'HOD') current.showMarks = !!req.body.showMarks;
    else {
        current.subjectMarks = current.subjectMarks || {};
        current.subjectMarks[req.staff.subject] = !!req.body.showMarks;
    }
    writeJSON(settingsFile, current);
    res.json({ success: true });
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
