const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001; // Use port 3001 for automated test to avoid conflicting with active 3000
process.env.PORT = PORT;

console.log("=== Starting Mobile Exam Portal Automated Tests ===");

// 1. Require server.js
require('./server.js');

function request(options, data) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        if (data) {
            req.write(data);
        }
        req.end();
    });
}

// 1x1 transparent JPEG in base64
const sampleJpgBase64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

setTimeout(async () => {
    try {
        // Test 1: Fetch Home Page (index.html)
        console.log("\n[Test 1] GET / (Serving index.html)...");
        const resHome = await request({ hostname: 'localhost', port: PORT, path: '/', method: 'GET' });
        if (resHome.statusCode === 200 && resHome.body.includes("College Secure Exam")) {
            console.log("PASS: index.html served successfully (HTTP 200)");
        } else {
            throw new Error(`FAIL: Unexpected home response: ${resHome.statusCode}`);
        }

        // Test 2: Log Violation
        console.log("\n[Test 2] POST /api/log-cheat...");
        const studentId = "STUDENT_TEST_99";
        const cheatPayload = JSON.stringify({
            studentId,
            reason: "Looking Away from Screen",
            strike: 1
        });
        const resCheat = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/log-cheat',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(cheatPayload)
            }
        }, cheatPayload);

        if (resCheat.statusCode === 200) {
            console.log("PASS: Violation logged successfully (HTTP 200):", resCheat.body);
        } else {
            throw new Error(`FAIL: /api/log-cheat failed: ${resCheat.statusCode}`);
        }

        // Test 3: Upload Snapshot
        console.log("\n[Test 3] POST /api/upload-snapshot...");
        const snapPayload = JSON.stringify({
            studentId,
            image: sampleJpgBase64
        });
        const resSnap = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/upload-snapshot',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(snapPayload)
            }
        }, snapPayload);

        if (resSnap.statusCode === 200) {
            console.log("PASS: Snapshot uploaded successfully (HTTP 200):", resSnap.body);
        } else {
            throw new Error(`FAIL: /api/upload-snapshot failed: ${resSnap.statusCode}`);
        }

        // Verify snapshot file exists on disk
        const studentDir = path.join(__dirname, 'snapshots', studentId);
        if (fs.existsSync(studentDir) && fs.readdirSync(studentDir).length > 0) {
            console.log("PASS: Snapshot file verified on filesystem in:", studentDir);
        } else {
            throw new Error("FAIL: Snapshot file was not saved on filesystem");
        }

        // Test 4: Check Teacher Dashboard
        console.log("\n[Test 4] GET /teacher...");
        const resTeacher = await request({ hostname: 'localhost', port: PORT, path: '/teacher', method: 'GET' });
        if (resTeacher.statusCode === 200 && 
            resTeacher.body.includes(studentId) && 
            resTeacher.body.includes("Looking Away from Screen")) {
            console.log("PASS: Teacher dashboard displays logged strike and student details!");
        } else {
            throw new Error("FAIL: Teacher dashboard did not reflect student violation");
        }

        console.log("\n==========================================");
        console.log(">>> ALL TESTS PASSED SUCCESSFULLY! <<<");
        console.log("==========================================");
        process.exit(0);

    } catch (err) {
        console.error("Test Error:", err);
        process.exit(1);
    }
}, 800);
