const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/snapshots', express.static(path.join(__dirname, 'snapshots')));

// Direct Portal Routes
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'student.html')));
app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Paths
const uploadsDir = path.join(__dirname, 'uploads', 'questions');
const snapshotsDir = path.join(__dirname, 'snapshots');
const usersFile = path.join(__dirname, 'users.json');
const settingsFile = path.join(__dirname, 'exam_settings.json');
const submissionsFile = path.join(__dirname, 'submissions.json');
const questionsDir = path.join(__dirname, 'questions_by_subject');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });
if (!fs.existsSync(questionsDir)) fs.mkdirSync(questionsDir, { recursive: true });

// --- DATA HELPERS ---
function readJSON(file) {
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getQuestions(subject) {
    if (!subject) return readJSON(path.join(__dirname, 'questions.json'));
    const file = path.join(questionsDir, `${subject}.json`);
    const qs = readJSON(file);
    if (qs && qs.length > 0) return qs;
    // Fallback to default questions.json if subject file is empty
    return readJSON(path.join(__dirname, 'questions.json'));
}

function saveQuestions(subject, questions) {
    const file = path.join(questionsDir, `${subject}.json`);
    writeJSON(file, questions);
}

// --- STATE ---
let examActive = false;
const subjectExamStatus = {}; // { [subject]: boolean }
let activeStudents = []; 
const logs = [];

// Multer for question images
const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, uploadsDir); },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`);
    }
});
const upload = multer({ storage });

// =========================================
// 1. AUTHENTICATION & RBAC
// =========================================

app.post('/api/login', (req, res) => {
    const { id, password, role } = req.body;
    const users = readJSON(usersFile);
    const user = users.find(u => u.id === id && u.password === password && u.role === role);
    
    if (user) {
        res.json({ success: true, user });
    } else {
        res.status(401).json({ success: false, error: "Invalid credentials or role" });
    }
});

app.post('/api/create-user', (req, res) => {
    const { id, password, role, name, subject, className, dept } = req.body;
    const users = readJSON(usersFile);
    
    if (users.find(u => u.id === id)) {
        return res.status(400).json({ error: "ID already exists" });
    }
    
    users.push({ id, password, role, name, subject, className, dept });
    writeJSON(usersFile, users);
    res.json({ success: true });
});

app.get('/api/get-staff', (req, res) => {
    const users = readJSON(usersFile);
    const sanitized = users.map(u => ({
        id: u.id,
        name: u.name,
        role: u.role,
        className: u.className || '',
        subject: u.subject || '',
        dept: u.dept || 'Computer Engineering & AI'
    }));
    res.json(sanitized);
});

// =========================================
// 2. SUBJECT-WISE EXAM MANAGEMENT
// =========================================

app.post('/api/upload-question', upload.single('questionImage'), (req, res) => {
    const { subject, correctOption } = req.body;
    if (!req.file || !subject) return res.status(400).json({ error: "Missing image or subject." });

    const imagePath = `/uploads/questions/${req.file.filename}`;
    const questions = getQuestions(subject);
    
    questions.push({
        id: 'Q_' + Date.now(),
        image: imagePath,
        correct: (correctOption || '').toUpperCase().trim(),
        createdAt: new Date().toLocaleString()
    });
    
    saveQuestions(subject, questions);
    res.json({ success: true });
});

app.get('/api/get-questions', (req, res) => {
    const { subject } = req.query;
    if (!subject) return res.status(400).json({ error: "Subject required" });
    
    const questions = getQuestions(subject);
    const studentView = questions.map((q, idx) => ({
        id: q.id,
        index: idx,
        image: q.image
    }));
    res.json(studentView);
});

app.post('/api/delete-question', (req, res) => {
    const { subject, id } = req.body;
    let questions = getQuestions(subject);
    questions = questions.filter(q => q.id !== id);
    saveQuestions(subject, questions);
    res.json({ success: true });
});

// =========================================
// 3. STUDENT JOIN & EXAM FLOW
// =========================================

app.post('/api/join', (req, res) => {
    const { collegeId, rollNo, name, className, division, dept, regNo, subject } = req.body;
    if (!rollNo || !subject) return res.status(400).json({ error: "Roll No and Subject are required." });

    const cleanRoll = rollNo.trim();
    const cleanSub = subject.trim();
    
    // Check if exam is released for this subject
    const isSubjectActive = subjectExamStatus[cleanSub] !== undefined ? subjectExamStatus[cleanSub] : examActive;

    // Check if student already joined
    const existingIndex = activeStudents.findIndex(s => s.roll === cleanRoll && s.subject === cleanSub);
    const studentEntry = {
        id: collegeId || cleanRoll,
        roll: cleanRoll,
        name: name || 'Student',
        className: className || '',
        division: division || '',
        dept: dept || '',
        regNo: regNo || '',
        subject: cleanSub,
        status: isSubjectActive ? 'in_exam' : 'waiting',
        time: new Date().toLocaleTimeString()
    };

    if (existingIndex >= 0) {
        activeStudents[existingIndex] = studentEntry;
    } else {
        activeStudents.push(studentEntry);
    }

    res.json({ success: true, examActive: isSubjectActive });
});

app.get('/api/check-status', (req, res) => {
    const { subject } = req.query;
    if (subject && subjectExamStatus[subject] !== undefined) {
        return res.json({ active: !!subjectExamStatus[subject] });
    }
    res.json({ active: examActive });
});

app.post('/api/start-exam', (req, res) => {
    const { subject } = req.body;
    if (subject) {
        subjectExamStatus[subject] = true;
    }
    examActive = true;
    activeStudents.forEach(s => { 
        if (!subject || s.subject === subject) {
            s.status = 'in_exam'; 
        }
    });
    res.json({ success: true, active: true, subject });
});

app.post('/api/stop-exam', (req, res) => {
    const { subject } = req.body;
    if (subject) {
        subjectExamStatus[subject] = false;
    } else {
        examActive = false;
    }
    activeStudents.forEach(s => { 
        if (!subject || s.subject === subject) {
            s.status = 'waiting'; 
        }
    });
    res.json({ success: true, active: false, subject });
});

app.get('/api/waiting-students', (req, res) => {
    const { subject } = req.query;
    const filtered = activeStudents.filter(s => !subject || s.subject === subject);
    res.json({
        total: filtered.length,
        waiting: filtered.filter(s => s.status === 'waiting').length,
        in_exam: filtered.filter(s => s.status === 'in_exam').length,
        isExamActive: subject && subjectExamStatus[subject] !== undefined ? subjectExamStatus[subject] : examActive,
        students: filtered
    });
});

app.post('/api/submit-exam', (req, res) => {
    const { collegeId, rollNo, subject, answers } = req.body;
    const questions = getQuestions(subject);
    const submissions = readJSON(submissionsFile);

    let score = 0;
    questions.forEach((q, idx) => {
        const studentAns = answers ? (answers[idx] || answers[q.id]) : null;
        if (q.correct && studentAns && studentAns.toUpperCase() === q.correct.toUpperCase()) {
            score++;
        }
    });

    const submissionEntry = {
        collegeId, rollNo, subject,
        score: `${score}/${questions.length}`,
        rawScore: score,
        total: questions.length,
        answers,
        time: new Date().toLocaleString()
    };

    submissions.unshift(submissionEntry);
    writeJSON(submissionsFile, submissions);
    res.json({ success: true, submission: submissionEntry });
});

// =========================================
// 4. MARKS & SETTINGS
// =========================================

app.get('/api/get-settings', (req, res) => {
    res.json(readJSON(settingsFile));
});

app.post('/api/update-settings', (req, res) => {
    const settings = req.body;
    writeJSON(settingsFile, settings);
    res.json({ success: true });
});

app.get('/api/get-submissions', (req, res) => {
    const { subject } = req.query;
    const all = readJSON(submissionsFile);
    if (subject) {
        res.json(all.filter(s => s.subject === subject));
    } else {
        res.json(all);
    }
});

// =========================================
// 5. PROCTORING
// =========================================

app.post('/api/log-cheat', (req, res) => {
    const { studentId, rollNo, reason, strike } = req.body;
    logs.unshift({ studentId, rollNo, reason, strike, time: new Date().toLocaleTimeString() });
    res.sendStatus(200);
});

app.post('/api/upload-snapshot', (req, res) => {
    const { studentId, image } = req.body;
    const base64Data = image.replace(/^data:image\/[^;]+;base64,/, "");
    const dir = path.join(snapshotsDir, studentId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(path.join(dir, `${Date.now()}.jpg`), base64Data, 'base64', () => res.sendStatus(200));
});

app.get('/teacher', (req, res) => {
    res.send("Please use the frontend index.html to access dashboards.");
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
