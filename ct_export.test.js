// Run with: node --test ct_export.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const xlsx = require('xlsx');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}

test('Class Teacher subject-wise Excel export: subject headers, marks, zero marks, missing marks, latest timestamp, and class isolation', async () => {
    // Isolated process directory so no production or student data is touched
    const base = fs.mkdtempSync(path.join(__dirname, '.ct-export-test-'));
    fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(base, 'server.js'));
    fs.writeFileSync(path.join(base, 'index.html'), 'Staff page');
    fs.writeFileSync(path.join(base, 'student.html'), 'Student page');
    fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(base, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

    // Fictitious test data (no real student records)
    const testUsers = [
        {
            id: 'CT_DIV_B',
            role: 'CLASS_TEACHER',
            name: 'Prof. Div B In-Charge',
            className: 'SY-AIML B',
            passwordHash: hashPassword('test-password-123')
        },
        {
            id: 'FAC_OS',
            role: 'FACULTY',
            name: 'Prof. Operating Systems',
            subject: 'OS',
            passwordHash: hashPassword('test-password-123')
        }
    ];

    const testExams = [
        { id: 'EXAM_DSA', title: 'Data Structures Exam', subject: 'DSA', totalMarks: 20 },
        { id: 'EXAM_AI', title: 'Artificial Intelligence Exam', subject: 'AI', totalMarks: 10 }
    ];

    const testStudents = [
        { rollNo: 'B001', name: 'Student One', className: 'SY-AIML B', division: 'B', dept: 'Computer' },
        { rollNo: 'B002', name: 'Student Two', className: 'SY-AIML B', division: 'B', dept: 'Computer' },
        { rollNo: 'A001', name: 'Student Foreign Div', className: 'SY-AIML A', division: 'A', dept: 'Computer' }
    ];

    const testSubmissions = [
        // B001 submissions across DSA, AI, and OS
        {
            rollNo: 'B001',
            name: 'Student One',
            subject: 'DSA',
            score: '17/20',
            rawScore: 17,
            total: 20,
            time: '2026-09-29T10:00:00.000Z'
        },
        {
            rollNo: 'B001',
            name: 'Student One',
            subject: 'AI',
            score: '8/10',
            rawScore: 8,
            total: 10,
            time: '2026-09-29T11:00:00.000Z'
        },
        {
            rollNo: 'B001',
            name: 'Student One',
            subject: 'OS',
            score: '6/10',
            rawScore: 6,
            total: 10,
            time: '2026-09-29T12:00:00.000Z'
        },
        // B002: Earlier submission for DSA had 10/20, but latest submission had 0/20
        {
            rollNo: 'B002',
            name: 'Student Two',
            subject: 'DSA',
            score: '10/20',
            rawScore: 10,
            total: 20,
            time: '2026-09-29T08:00:00.000Z'
        },
        {
            rollNo: 'B002',
            name: 'Student Two',
            subject: 'DSA',
            score: '0/20',
            rawScore: 0,
            total: 20,
            time: '2026-09-29T09:00:00.000Z' // Latest submission (timestamp descending rule)
        },
        // A001: Division A student submission
        {
            rollNo: 'A001',
            name: 'Student Foreign Div',
            subject: 'DSA',
            score: '19/20',
            rawScore: 19,
            total: 20,
            time: '2026-09-29T10:30:00.000Z'
        }
    ];

    fs.writeFileSync(path.join(base, 'users.json'), JSON.stringify(testUsers, null, 2));
    fs.writeFileSync(path.join(base, 'exams.json'), JSON.stringify(testExams, null, 2));
    fs.writeFileSync(path.join(base, 'students.json'), JSON.stringify(testStudents, null, 2));
    fs.writeFileSync(path.join(base, 'submissions.json'), JSON.stringify(testSubmissions, null, 2));

    const { spawn } = require('node:child_process');
    const net = require('node:net');
    const probe = net.createServer().listen(0);
    await once(probe, 'listening');
    const testPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));

    const child = spawn(process.execPath, [path.join(base, 'server.js')], {
        env: { ...process.env, PORT: String(testPort) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', d => { output += d; });

    try {
        for (let i = 0; i < 100 && !/localhost:\d+/.test(output); i++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const port = output.match(/localhost:(\d+)/)?.[1];
        assert.ok(port, 'Isolated server started on port ' + port);
        const baseURL = 'http://127.0.0.1:' + port;

        // 1. Log in as Class Teacher (Div B)
        const loginRes = await fetch(baseURL + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'CT_DIV_B', password: 'test-password-123', role: 'CLASS_TEACHER' })
        });
        assert.equal(loginRes.status, 200, 'Class Teacher login succeeded');
        const ctCookie = loginRes.headers.get('set-cookie')?.split(';')[0];
        assert.ok(ctCookie, 'Received staff session cookie');

        // 2. Request Excel export. Intentionally send division=ALL in query to verify server-side enforcement
        const exportRes = await fetch(baseURL + '/api/export-marks-excel?subject=ALL&division=ALL&role=CT', {
            headers: { Cookie: ctCookie }
        });
        assert.equal(exportRes.status, 200, 'Export route returned 200 OK');
        assert.match(
            exportRes.headers.get('content-type') || '',
            /spreadsheetml\.sheet/,
            'Returned correct Excel Content-Type'
        );
        const contentDisposition = exportRes.headers.get('content-disposition') || '';
        assert.ok(contentDisposition.includes('.xlsx'), 'Content-Disposition specifies .xlsx filename');

        // 3. Read and parse the generated .xlsx binary buffer
        const arrayBuffer = await exportRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const wb = xlsx.read(buffer, { type: 'buffer' });
        assert.ok(wb.SheetNames.includes('Official_Marksheet'), 'Workbook contains Official_Marksheet');

        const sheet = wb.Sheets['Official_Marksheet'];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        // Verify college heading rows are preserved
        assert.equal(rows[0][0], 'G. H. RAISONI COLLEGE OF ENGINEERING AND MANAGEMENT, PUNE');
        assert.equal(rows[1][0], '(An Autonomous Institute Affiliated to Savitribai Phule Pune University)');
        assert.equal(rows[2][0], 'DEPARTMENT OF COMPUTER ENGINEERING & ARTIFICIAL INTELLIGENCE');
        assert.equal(rows[3][0], 'AUTONOMOUS EXAMINATION OFFICIAL MARKSHEET & GAZETTE');

        // Locate the table header row
        const headerRowIndex = rows.findIndex(r => r && r[0] === 'Roll Number');
        assert.ok(headerRowIndex >= 0, 'Found header row starting with Roll Number');
        const headers = rows[headerRowIndex];

        // 4. Verify Student Identity columns and Dynamic Subject Headers
        assert.equal(headers[0], 'Roll Number');
        assert.equal(headers[1], 'Candidate Full Name');
        assert.equal(headers[2], 'Class');
        assert.equal(headers[3], 'Division');

        // Subjects must include dynamically discovered subjects: AI (from exams), DSA (from exams), OS (from faculty & submissions)
        assert.ok(headers.includes('AI'), 'Header includes AI subject column');
        assert.ok(headers.includes('DSA'), 'Header includes DSA subject column');
        assert.ok(headers.includes('OS'), 'Header includes OS subject column');

        const aiCol = headers.indexOf('AI');
        const dsaCol = headers.indexOf('DSA');
        const osCol = headers.indexOf('OS');

        // 5. Verify Student Rows & Class Isolation
        const dataRows = rows.slice(headerRowIndex + 1).filter(r => r && r.length > 0);
        const rollNumbers = dataRows.map(r => r[0]);

        // Class isolation: Division B teacher must only see B001 and B002, NOT A001
        assert.ok(rollNumbers.includes('B001'), 'Includes student B001 from Division B');
        assert.ok(rollNumbers.includes('B002'), 'Includes student B002 from Division B');
        assert.equal(rollNumbers.includes('A001'), false, 'Class isolation enforced: Student A001 from Div A is excluded');

        // 6. Verify B001 marks (DSA: 17/20, AI: 8/10, OS: 6/10)
        const rowB001 = dataRows.find(r => r[0] === 'B001');
        assert.equal(rowB001[1], 'Student One');
        assert.equal(rowB001[2], 'SY-AIML B');
        assert.equal(rowB001[3], 'B');
        assert.equal(rowB001[dsaCol], '17/20', 'B001 DSA marks correctly formatted as 17/20');
        assert.equal(rowB001[aiCol], '8/10', 'B001 AI marks correctly formatted as 8/10');
        assert.equal(rowB001[osCol], '6/10', 'B001 OS marks correctly formatted as 6/10');

        // 7. Verify B002 marks:
        // - Multiple submissions timestamp rule: latest submission had 0/20 (earlier had 10/20)
        // - Zero marks: preserved as '0/20'
        // - Missing marks: AI and OS show '—'
        const rowB002 = dataRows.find(r => r[0] === 'B002');
        assert.equal(rowB002[1], 'Student Two');
        assert.equal(rowB002[dsaCol], '0/20', 'B002 DSA marks preserves real zero score 0/20 using latest timestamp');
        assert.equal(rowB002[aiCol], '—', 'B002 AI missing mark represented by —');
        assert.equal(rowB002[osCol], '—', 'B002 OS missing mark represented by —');
    } finally {
        child.kill();
        await exited.catch(() => {});
        fs.rmSync(base, { recursive: true, force: true });
    }
});
