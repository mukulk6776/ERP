# Shambhu Dayal Global School

A single-school ERP with staff, parent, and student accounts, fictional demo records, and working school administration workflows.

## Start

Requires Node.js 24 or later. Double-click start.cmd or run npm start, then open http://127.0.0.1:3000.
No package installation is needed.

On first use, enter your name, email, and a personal password of 15–128 characters.
If upgrading from the shared school password, enter that existing password to create the first administrator.
The shared password is removed after migration. School records stay intact. There are no default credentials or public registration.

## Staff accounts

Administrators use School accounts to create accounts and select access:

| Role | Access |
| --- | --- |
| Administrator | School records, admissions, classes, staff, academics, finance, operations, account management, settings, and audit activity |
| Teacher | Student/staff directory, attendance, classes/timetable, assessments, homework and grading, library catalogue, and own leave requests |
| Accounts staff | Student/staff directory, invoices, payments, expenses, payroll, financial reports, and own leave requests |
| Parent | Only linked children: attendance, fee account, published results, homework, timetable, loans, transport, notices, and leave requests |
| Student | Only the linked student record, plus homework submission and leave requests |

New accounts receive a private password setup link on screen. Share it directly with the intended person.
Links expire in 30 minutes and work once. They are not emailed. Staff who forget their password should ask an administrator for a new link.
Password links are checked before the password form appears and show the intended staff account.
Expired, replaced, disabled-account, or previously used links show a message asking for a new link.
After setting a password, sign in with the staff email already filled in. Recovery also clears any failed-login lockout for that account.
Use My account to change your own password or sign out on all devices.
Disabling an account or changing its role immediately revokes its sessions and outstanding setup/reset links.
Administrators cannot disable themselves or change their own role.

If the only administrator forgets their password, the computer owner can run:
`node tools/recover-admin.js administrator@email.example`
This generates a private one-use recovery link for an existing active administrator and records the action.
This utility requires local database access and is never available as a web endpoint. Do not share access to the data folder.

## Security behavior

Passwords use asynchronous scrypt with N=131072, r=8, p=1 and unique random salts.
Session cookies are HttpOnly and SameSite=Strict. The database stores only hashes of session and reset tokens.
Sessions have a 30-minute idle timeout and an eight-hour absolute lifetime, and survive app restarts until they expire.
Login throttling persists across restarts and applies per identity and source address. Browser writes require a per-session CSRF token.
Roles are enforced by the server; teacher state responses exclude finance and supply data.
Password changes and resets revoke existing sessions. A password change keeps only a newly rotated current session.
Expired sessions return to sign-in, close open account dialogs, and clear school records from browser memory.
Delayed responses from a previous account cannot restore its school records after returning to sign-in.
Recent authentication and account-management activity is visible to administrators.

The app binds to 127.0.0.1. Before use over a network, provide HTTPS through a correctly configured reverse proxy,
set ERP_ORIGIN to the exact HTTPS origin, and set ERP_SECURE_COOKIE=1. Keep the current loopback binding behind the proxy.
There is no email provider, SSO, or multifactor authentication configured. Backups, monitoring, and a deployment access review remain necessary before public hosting.

## School office

| Module | Working operations |
| --- | --- |
| Overview | Live enrolment, attendance, collection trends, outstanding invoices, notices, and class counts |
| Students | Create/edit profiles, class transfer, guardian contacts, archive/reactivate, profile printing, search/filter/export |
| Admissions | Enquiry/interview/accept/decline, capacity-checked enrolment, linked student record |
| Staff & classes | Employment directory, monthly salary defaults, teacher/room assignments, class capacity |
| Attendance | Date and class filters, individual and bulk marking, save only changed students, reports |
| Fee invoices | Raise charges, partial payments, balances, overdue status, invoice printing, cancellation |
| Fee receipts | Idempotent recording, overpayment prevention, print receipts, audited voiding that restores invoice dues |
| Expenses & payroll | Expense ledger, monthly salary drafts, allowances/deductions, salary payment entries, payslips |
| Exams & results | Schedule, enter marks, validate score limits, publish/lock results, printable result sheets |
| Timetable | Class/teacher/room conflict checks, edit and remove periods |
| Homework | Class assignments, student text submissions, teacher grading/feedback, graded-work lock |
| Leave | Staff/student requests, linked-student checks, overlap detection, administrator approval/decline |
| Library | Catalogue/copy counts, issue/return, availability checks, overdue loans |
| Transport | Routes, vehicles, drivers, boarding stops, capacity-checked student allocations |
| Supplies | Item/quantity management, archive items, transactional stock distribution |
| Notices | Publication/expiry dates and staff/parent/student audiences |
| Reports | Date/class filters, attendance summaries, collections, current dues, CSV exports, printable reports |
| Family portals | Separate parent/student screens, sibling switching, only linked records, receipts and report cards |
| Settings & audit | School identity, academic year, database snapshots, operational activity and account activity |

Payroll records money already paid; it does not initiate bank transfers. Fee collection does not connect to an online payment gateway.
Homework submissions are text. Email/SMS delivery, SSO, MFA, and statutory payroll filing are not connected. Hostel management is excluded.

## Sample school and deployment

Set `ERP_DEMO=1` before starting the app, or select **Settings → Load sample data** in an empty school.
This creates 72 fictional students, 12 staff, 8 classes, 144 invoices, attendance, assessments/results,
homework/submissions, payroll, books/loans, transport allocations, expenses, notices, and leave requests.
The seed is transactional and idempotent. It refuses to populate a nonempty school and never creates default passwords.
Create your own administrator account, then use School accounts to invite staff, parents, and students.
Parent accounts require linked students; student accounts require exactly one linked student.

See [OPERATIONS.md](OPERATIONS.md) for HTTPS deployment, environment settings, backups, restoration, and operational limits.

## Storage and backups

The SQLite database is data/erp.sqlite. Authentication and school records share this database.
Before the authentication upgrade, a consistent snapshot is saved under data/backups.
Protect backups as carefully as the live database. Stop the app before manually copying or restoring the entire data folder.
Restoring old authentication backups may restore old passwords and sessions; rotate staff passwords after disaster recovery.

Environment options: PORT (3000), ERP_DATA_DIR (data beside server.js), ERP_ORIGIN, ERP_SECURE_COOKIE.
No runtime secrets belong in source control.

## Verification

Run `npm test` for authentication, permissions, migration, family-record isolation, money and stock transactions,
capacity checks, academic publishing, homework, leave, payroll, and backup integrity.
Run `npm run test:browser` for authentication and existing school workflows.
Run `npm run test:workflows` for all module screens and end-to-end admissions, partial fees, lending,
transport, marks, payroll, family portals, homework, leave, and mobile layouts.
Browser tests automatically find Chrome or Microsoft Edge on Windows; set `CHROME_BINARY` to use another Chromium executable. All tests use isolated temporary databases.
