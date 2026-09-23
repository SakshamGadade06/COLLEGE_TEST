# College exam portal prototype

## Local setup

1. Install Node.js and run `npm ci`.
2. Set `BOOTSTRAP_HOD_ID` and a unique `BOOTSTRAP_HOD_PASSWORD` of at least 12 characters in your terminal. The server creates a HOD or resets the matching HOD's old plain-text password at startup. Remove the password from your environment after initial setup.
3. Run `npm start`. Open `http://localhost:3000/staff` or `http://localhost:3000/student`.
4. Run `node --test security.test.js` to check the key access and submission rules.

Local `users.json`, `submissions.json`, snapshots, and uploaded questions are excluded from future commits. Old plain-text passwords can no longer log in. An HOD can assign new passwords to existing staff with `POST /api/reset-password` using a logged-in HOD browser session, JSON `{ "id": "STAFF_ID", "password": "NEW_UNIQUE_12_PLUS_CHARACTER_PASSWORD" }`.

## Important limits

- This repo is public and **earlier Git commits may still contain passwords and student records**. Rotate every password that appeared in `users.json`, remove the records from Git history with a coordinated repository cleanup, and review GitHub forks/caches before treating the exposure as resolved.
- Students currently identify themselves by entering a roll number. Their temporary browser session prevents simple request forgery but does not prove their real-world identity. Integrate college authentication before real exams.
- Staff and student sessions, exam deadlines, and waiting-room state are stored in server memory. A server restart logs everyone out and stops active exams. Use persistent storage before production.
- Proctoring events reported by browser JavaScript are signals for a human reviewer, not proof of cheating.
- HTTPS is required in production for camera access and secure session cookies.
