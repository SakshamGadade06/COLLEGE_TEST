const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3003;
process.env.PORT = PORT;

console.log("=== Testing Multer Upload & Dynamic Questions ===");
require('./server.js');

function multipartUpload(boundary, filename, fileBuffer, correctOption) {
    return new Promise((resolve, reject) => {
        let body = '';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="correctOption"\r\n\r\n`;
        body += `${correctOption}\r\n`;
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="questionImage"; filename="${filename}"\r\n`;
        body += `Content-Type: image/jpeg\r\n\r\n`;

        const preBuffer = Buffer.from(body, 'utf8');
        const postBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const fullPayload = Buffer.concat([preBuffer, fileBuffer, postBuffer]);

        const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/upload-question',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': fullPayload.length,
                'Accept': 'application/json'
            }
        }, (res) => {
            let resData = '';
            res.on('data', chunk => resData += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body: resData }));
        });

        req.on('error', reject);
        req.write(fullPayload);
        req.end();
    });
}

function getRequest(reqPath) {
    return new Promise((resolve, reject) => {
        http.get({ hostname: 'localhost', port: PORT, path: reqPath }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }).on('error', reject);
    });
}

setTimeout(async () => {
    try {
        // 1. Upload a mock JPEG
        console.log("\n[Test 1] Uploading question image via Multer multipart...");
        const boundary = '----WebKitFormBoundaryXYZ12345';
        const dummyJpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
        
        const uploadRes = await multipartUpload(boundary, 'question1.jpg', dummyJpg, 'C');
        console.log("Upload Status:", uploadRes.statusCode, uploadRes.body);

        if (uploadRes.statusCode !== 200) {
            throw new Error(`Upload failed with status ${uploadRes.statusCode}`);
        }

        // 2. Fetch questions as student
        console.log("\n[Test 2] Student fetching /api/get-questions...");
        const getRes = await getRequest('/api/get-questions');
        const questions = JSON.parse(getRes.body);
        console.log("Fetched questions count:", questions.length);
        if (questions.length === 0 || !questions[0].image.includes('/uploads/questions/')) {
            throw new Error("Invalid questions response: " + getRes.body);
        }
        console.log("PASS: Question correctly stored and served at:", questions[0].image);

        // 3. Verify teacher dashboard renders upload form and question
        console.log("\n[Test 3] Checking /teacher dashboard...");
        const teacherRes = await getRequest('/teacher');
        if (teacherRes.body.includes('Upload New Question (Image)') && teacherRes.body.includes('/uploads/questions/')) {
            console.log("PASS: Teacher dashboard rendered upload form and question gallery!");
        } else {
            throw new Error("Teacher dashboard did not render expected elements.");
        }

        console.log("\n==============================================");
        console.log(">>> MULTER INTEGRATION TEST PASSED! <<<");
        console.log("==============================================");
        process.exit(0);

    } catch (err) {
        console.error("Test failed:", err);
        process.exit(1);
    }
}, 800);
