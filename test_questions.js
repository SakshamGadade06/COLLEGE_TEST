const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;
process.env.PORT = PORT;

console.log("=== Testing Teacher Question Upload & Dynamic Exam Flow ===");
require('./server.js');

function request(options, data) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

// 1x1 sample PNG base64
const samplePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

setTimeout(async () => {
    try {
        // Step 1: Teacher uploads a question with an image
        console.log("\n[Step 1] Teacher uploads a question image via POST /api/upload-question...");
        const questionPayload = JSON.stringify({
            title: "Physics Problem 1 - Acceleration",
            image: samplePng,
            options: ["A", "B", "C", "D"],
            correctOption: "B"
        });

        const resUpload = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/upload-question',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(questionPayload)
            }
        }, questionPayload);

        const uploadData = JSON.parse(resUpload.body);
        if (resUpload.statusCode === 200 && uploadData.status === "success") {
            console.log("PASS: Question uploaded successfully! ID:", uploadData.question.id, "Image:", uploadData.question.imageUrl);
        } else {
            throw new Error(`Upload failed: ${resUpload.statusCode} ${resUpload.body}`);
        }

        const questionId = uploadData.question.id;

        // Step 2: Student fetches questions via GET /api/questions
        console.log("\n[Step 2] Student retrieves questions via GET /api/questions...");
        const resGetQ = await request({ hostname: 'localhost', port: PORT, path: '/api/questions', method: 'GET' });
        const questions = JSON.parse(resGetQ.body);
        if (questions.length > 0 && questions[0].title === "Physics Problem 1 - Acceleration") {
            console.log("PASS: Student retrieved dynamic question list correctly! Count:", questions.length);
            // Verify correctOption is not exposed to student
            if (questions[0].correctOption === undefined) {
                console.log("PASS: Security verified - correct answer is hidden from student API response.");
            }
        } else {
            throw new Error("Failed to retrieve questions");
        }

        // Step 3: Student submits answers
        console.log("\n[Step 3] Student submits answers via POST /api/submit-exam...");
        const answersPayload = JSON.stringify({
            studentId: "STUDENT_TEST_101",
            answers: { [questionId]: "B" } // Correct answer
        });
        const resSubmit = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/submit-exam',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(answersPayload)
            }
        }, answersPayload);
        const submitData = JSON.parse(resSubmit.body);
        if (submitData.status === "success" && submitData.submission.score.includes("1/")) {
            console.log("PASS: Exam submitted and auto-graded correctly! Score:", submitData.submission.score);
        } else {
            throw new Error(`Submit failed: ${resSubmit.body}`);
        }

        // Step 4: Teacher verifies Dashboard
        console.log("\n[Step 4] Checking Teacher Dashboard at GET /teacher...");
        const resTeacher = await request({ hostname: 'localhost', port: PORT, path: '/teacher', method: 'GET' });
        if (resTeacher.body.includes("Physics Problem 1") && resTeacher.body.includes("STUDENT_TEST_101")) {
            console.log("PASS: Teacher dashboard displays uploaded question and student submission!");
        } else {
            throw new Error("Teacher dashboard did not render question or submission");
        }

        console.log("\n=======================================================");
        console.log(">>> ALL QUESTION UPLOAD & EXAM TESTS PASSED! <<<");
        console.log("=======================================================");
        process.exit(0);

    } catch (e) {
        console.error("Test Error:", e);
        process.exit(1);
    }
}, 800);
