// Run with: node --test student_entry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const net = require('node:net');
const xlsx = require('xlsx');

test('Student portal cascading roster, PRN separation, duplicate names, and authoritative server join verification', async () => {
    const base = fs.mkdtempSync(path.join(__dirname, '.student-test-'));
    fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(base, 'server.js'));
    fs.writeFileSync(path.join(base, 'index.html'), 'Staff page');
    fs.writeFileSync(path.join(base, 'student.html'), 'Student page');
    fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(base, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

    const probe = net.createServer().listen(0);
    await once(probe, 'listening');
    const testPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));

    const child = spawn(process.execPath, [path.join(base, 'server.js')], {
        env: {
            ...process.env,
            PORT: String(testPort),
            BOOTSTRAP_HOD_ID: 'HODTEST',
            BOOTSTRAP_HOD_PASSWORD: 'long-test-password-123'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', d => { output += d; });

    try {
        for (let i = 0; i < 100 && !/localhost:\d+/.test(output); i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        const port = output.match(/localhost:(\d+)/)?.[1];
        assert.ok(port, 'Server started on test port');
        const baseURL = 'http://127.0.0.1:' + port;

        async function request(url, body, cookie) {
            const res = await fetch(baseURL + url, {
                method: body ? 'POST' : 'GET',
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(cookie ? { Cookie: cookie } : {})
                },
                body: body && JSON.stringify(body)
            });
            let data;
            try { data = await res.json(); } catch { data = null; }
            return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], data };
        }

        // 1. Initial State: empty roster should return empty departments
        const emptyDepts = await request('/api/roster/departments');
        assert.equal(emptyDepts.status, 200);
        assert.deepEqual(emptyDepts.data.departments, []);

        // 2. Login as HOD to upload roster
        const hod = await request('/api/login', { id: 'HODTEST', password: 'long-test-password-123', role: 'HOD' });
        assert.equal(hod.status, 200);

        // 3. Test Excel Upload with separate Roll No and PRN columns, plus duplicate student names
        const rosterRows = [
            {
                "Roll Number": "B101",
                "Candidate Full Name": "Aarav Sharma",
                "PRN": "PRN2026101",
                "Department": "Artificial Intelligence & Data Science",
                "Class": "SY-AIDS B",
                "Division": "B"
            },
            {
                "Roll No": "B102",
                "Candidate Name": "Aarav Sharma", // Same name in same division (Duplicate name test)
                "Registration Number": "PRN2026102",
                "Department": "Artificial Intelligence & Data Science",
                "Year": "SY",
                "Division": "B"
            },
            {
                "Roll No": "A101",
                "Candidate Name": "Pooja Patel",
                // No PRN provided -> should be empty string, NOT fabricated
                "Department": "Artificial Intelligence & Data Science",
                "Class": "SY-AIDS A",
                "Division": "A"
            },
            {
                "Roll No": "TY301",
                "Candidate Name": "Rohan Deshmukh",
                "PRN": "PRN2024301",
                "Department": "Computer Engineering",
                "Class": "TY-COMP A",
                "Division": "A"
            },
            {
                // Older record style: only className given as "Final Year-COMP C"
                "Roll No": "LY401",
                "Candidate Name": "Sneha Joshi",
                "PRN": "PRN2023401",
                "Department": "Computer Engineering",
                "Class": "Final Year-COMP C"
            }
        ];

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(rosterRows);
        xlsx.utils.book_append_sheet(wb, ws, 'Roster');
        const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const formData = new FormData();
        formData.append('file', new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'students.xlsx');

        const uploadRes = await fetch(baseURL + '/api/upload-students', {
            method: 'POST',
            headers: { Cookie: hod.cookie },
            body: formData
        });
        const uploadData = await uploadRes.json();
        assert.equal(uploadRes.status, 200);
        assert.equal(uploadData.success, true);
        assert.equal(uploadData.added, 5);

        // 4. Test Cascading Endpoints
        // Step 4a: Departments
        const deptsRes = await request('/api/roster/departments');
        assert.equal(deptsRes.status, 200);
        assert.deepEqual(deptsRes.data.departments, [
            "Artificial Intelligence & Data Science",
            "Computer Engineering"
        ]);

        // Step 4b: Years for AI & Data Science
        const yearsRes = await request('/api/roster/years?dept=' + encodeURIComponent("Artificial Intelligence & Data Science"));
        assert.equal(yearsRes.status, 200);
        assert.deepEqual(yearsRes.data.years, ["SY"]);

        // Step 4c: Years for Computer Engineering
        const compYears = await request('/api/roster/years?dept=' + encodeURIComponent("Computer Engineering"));
        assert.equal(compYears.status, 200);
        assert.deepEqual(compYears.data.years, ["TY", "Final Year"]);

        // Step 4d: Divisions for AI & Data Science SY
        const divsRes = await request('/api/roster/divisions?dept=' + encodeURIComponent("Artificial Intelligence & Data Science") + '&year=SY');
        assert.equal(divsRes.status, 200);
        assert.deepEqual(divsRes.data.divisions, ["A", "B"]);

        // Step 4e: Division for Computer Engineering Final Year (parsed from "Final Year-COMP C")
        const compFinalDivs = await request('/api/roster/divisions?dept=' + encodeURIComponent("Computer Engineering") + '&year=' + encodeURIComponent("Final Year"));
        assert.equal(compFinalDivs.status, 200);
        assert.deepEqual(compFinalDivs.data.divisions, ["C"]);

        // Step 4f: Students in AI & Data Science SY Division B (Checking Roll vs PRN separation and duplicates)
        const divBStudents = await request('/api/roster/students?dept=' + encodeURIComponent("Artificial Intelligence & Data Science") + '&year=SY&division=B');
        assert.equal(divBStudents.status, 200);
        assert.equal(divBStudents.data.students.length, 2);

        const s1 = divBStudents.data.students.find(s => s.rollNo === 'B101');
        assert.ok(s1);
        assert.equal(s1.name, 'Aarav Sharma');
        assert.equal(s1.rollNo, 'B101'); // Roll number NOT corrupted by PRN
        assert.equal(s1.registrationNo, 'PRN2026101'); // PRN correctly preserved

        const s2 = divBStudents.data.students.find(s => s.rollNo === 'B102');
        assert.ok(s2);
        assert.equal(s2.name, 'Aarav Sharma'); // Duplicate name
        assert.equal(s2.rollNo, 'B102'); // Disambiguated by roll
        assert.equal(s2.registrationNo, 'PRN2026102');

        // Step 4g: Check student with no PRN (A101)
        const divAStudents = await request('/api/roster/students?dept=' + encodeURIComponent("Artificial Intelligence & Data Science") + '&year=SY&division=A');
        assert.equal(divAStudents.status, 200);
        const sA1 = divAStudents.data.students[0];
        assert.equal(sA1.rollNo, 'A101');
        assert.equal(sA1.name, 'Pooja Patel');
        assert.equal(sA1.registrationNo, ''); // Empty string, no fabrication

        // 5. Server-Side /api/join Verification & Tamper Resistance
        // Step 5a: Unlisted student should be rejected (403)
        const unlistedJoin = await request('/api/join', {
            rollNo: 'UNKNOWN999',
            name: 'Hacker',
            subject: 'DSA'
        });
        assert.equal(unlistedJoin.status, 403);
        assert.match(unlistedJoin.data.error, /verified institutional roster/i);

        // Step 5b: Client tampering attempt - sending valid Roll No but forged Name and fake PRN
        const forgedJoin = await request('/api/join', {
            rollNo: 'B101',
            name: 'Forged Impersonator',
            regNo: 'FAKE_PRN_99999',
            subject: 'DSA'
        });
        assert.equal(forgedJoin.status, 200);
        // Server MUST return authoritative record details, ignoring forged values
        assert.equal(forgedJoin.data.student.name, 'Aarav Sharma');
        assert.equal(forgedJoin.data.student.rollNo, 'B101');
        assert.equal(forgedJoin.data.student.registrationNo, 'PRN2026101');
        assert.equal(forgedJoin.data.student.division, 'B');

    } finally {
        child.kill();
        await exited.catch(() => {});
        fs.rmSync(base, { recursive: true, force: true });
    }
});
