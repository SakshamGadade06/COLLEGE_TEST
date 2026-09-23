const http = require('http');

const PORT = 3004;
process.env.PORT = PORT;

console.log("=== Testing Waiting Room & Master Switch System ===");
require('./server.js');

function postRequest(path, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function getRequest(path) {
    return new Promise((resolve, reject) => {
        http.get({ hostname: 'localhost', port: PORT, path }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }).on('error', reject);
    });
}

setTimeout(async () => {
    try {
        // Test 1: Initial status check
        console.log("\n[Test 1] Checking initial status (should be locked)...");
        const resInit = await getRequest('/api/check-status');
        const statusInit = JSON.parse(resInit.body);
        if (statusInit.active === false) {
            console.log("PASS: Exam is initially locked (active: false)");
        } else {
            throw new Error("Exam was active initially");
        }

        // Test 2: Student Joins
        console.log("\n[Test 2] Student joining waiting room (COLL123, ROLL50)...");
        const resJoin = await postRequest('/api/join', { collegeId: 'COLL123', rollNo: 'ROLL50' });
        if (resJoin.statusCode === 200) {
            console.log("PASS: Student successfully joined waiting room (HTTP 200)");
        } else {
            throw new Error("Join failed: " + resJoin.body);
        }

        // Test 3: Duplicate Join Prevention
        console.log("\n[Test 3] Testing duplicate roll prevention...");
        const resDup = await postRequest('/api/join', { collegeId: 'COLL999', rollNo: 'ROLL50' });
        if (resDup.statusCode === 400) {
            console.log("PASS: Duplicate roll blocked with HTTP 400:", resDup.body);
        } else {
            throw new Error("Duplicate roll was not blocked!");
        }

        // Test 4: Verify Teacher Dashboard displays waiting student
        console.log("\n[Test 4] Checking /teacher dashboard for waiting student...");
        const resTeacher = await getRequest('/teacher');
        if (resTeacher.body.includes('ROLL50') && resTeacher.body.includes('In Waiting Room')) {
            console.log("PASS: ROLL50 appears in Teacher Dashboard waiting list!");
        } else {
            throw new Error("ROLL50 not found in teacher dashboard");
        }

        // Test 5: Teacher Releases Exam
        console.log("\n[Test 5] Teacher releasing exam (POST /api/start-exam)...");
        const resStart = await postRequest('/api/start-exam', {});
        if (resStart.statusCode === 200) {
            console.log("PASS: Start exam executed successfully");
        } else {
            throw new Error("Start exam failed");
        }

        // Test 6: Student Polling detects active exam
        console.log("\n[Test 6] Student polling /api/check-status?rollNo=ROLL50...");
        const resPoll = await getRequest('/api/check-status?rollNo=ROLL50');
        const pollData = JSON.parse(resPoll.body);
        if (pollData.active === true) {
            console.log("PASS: Polling returned active: true! Student enters exam!");
        } else {
            throw new Error("Polling did not detect active exam");
        }

        // Test 7: Verify Student status changed to 'Writing Exam' in dashboard
        console.log("\n[Test 7] Checking /teacher dashboard student status...");
        const resTeacher2 = await getRequest('/teacher');
        if (resTeacher2.body.includes('Writing Exam') || resTeacher2.body.includes('ACTIVE')) {
            console.log("PASS: Teacher dashboard confirms student is writing exam and status is ACTIVE!");
        } else {
            throw new Error("Dashboard status did not update");
        }

        // Test 8: Teacher stops exam
        console.log("\n[Test 8] Teacher stopping exam (POST /api/stop-exam)...");
        const resStop = await postRequest('/api/stop-exam', {});
        const resPollAfterStop = await getRequest('/api/check-status');
        if (JSON.parse(resPollAfterStop.body).active === false) {
            console.log("PASS: Exam stopped and locked successfully!");
        } else {
            throw new Error("Exam was not stopped");
        }

        console.log("\n=======================================================");
        console.log(">>> WAITING ROOM & MASTER SWITCH TESTS ALL PASSED! <<<");
        console.log("=======================================================");
        process.exit(0);

    } catch (e) {
        console.error("Test Error:", e);
        process.exit(1);
    }
}, 800);
