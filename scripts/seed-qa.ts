/**
 * Insert the 70 QA Engineering objective questions into the Question bank.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-qa.ts                      # dry run
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-qa.ts --review out.md      # dry run + full review file
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-qa.ts --yes                # insert
 *
 * Source: "QA Engineering – Objective Test – Answer Key" (QA_Objective_Questions_
 * Answer_Key_Updated.pdf). That document is the interviewer's key: it gives each
 * question, its sub-topic, and the correct option as letter + text, but not the
 * three wrong options. The wrong options here were written for this bank.
 *
 * Correctness is enforced by construction, not by review alone: each entry
 * stores the key's letter and the key's answer text verbatim, and the four
 * options are assembled by placing that text at that letter. The checks below
 * then assert the invariant directly - the option at `correctAnswer` equals the
 * key's text - rather than trusting the assembly.
 *
 * Every question is 1 mark (the key: "1 mark each", 70 total) and MEDIUM, since
 * the key assigns no difficulty. Each carries its key sub-topic as its tag.
 *
 * Idempotent: a question whose text already exists in QA_ENGINEERING is skipped.
 * This file is also the restore path for these rows - keep it.
 *
 * Writes through DIRECT_URL (session, :5432), not the pgBouncer pooler.
 */
import 'dotenv/config'
import { writeFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
const CONFIRM = process.argv.includes('--yes')
const reviewIdx = process.argv.indexOf('--review')
const REVIEW_PATH = reviewIdx > -1 ? process.argv[reviewIdx + 1] : null

const AREA = 'QA_ENGINEERING' as const
type Letter = 'A' | 'B' | 'C' | 'D'

/** n: question number in the key. key/answer: verbatim from the key. wrong: the other three, in letter order. */
type Entry = { n: number; tag: string; q: string; key: Letter; answer: string; wrong: [string, string, string] }

const T = {
  FUND: 'QA & Testing Fundamentals',
  REQ: 'Requirement Analysis & Test Planning',
  DESIGN: 'Test Design Techniques',
  DEFECT: 'Defect Management',
  FUNC: 'Functional & Regression Testing',
  API: 'API Testing',
  SQL: 'SQL & Database Testing',
  AUTO: 'Test Automation',
  FRAME: 'Automation Framework Design',
  PERF: 'Performance Testing',
  SEC: 'Security Testing Basics',
  CICD: 'CI/CD & DevOps for QA',
  AI: 'AI-Assisted Testing',
  E2E: 'End-to-End Scenarios',
}

const ENTRIES: Entry[] = [
  // ── A. Testing Foundations ────────────────────────────────────────────────
  { n: 1, tag: T.FUND, q: 'Which SDLC model pairs each development phase with a corresponding testing phase?',
    key: 'C', answer: 'V-Model', wrong: ['Waterfall model', 'Spiral model', 'Big Bang model'] },
  { n: 2, tag: T.FUND, q: 'Which testing level checks the interaction between integrated modules?',
    key: 'D', answer: 'Integration testing', wrong: ['Unit testing', 'System testing', 'Acceptance testing'] },
  { n: 3, tag: T.FUND, q: 'The main purpose of software testing is to:',
    key: 'B', answer: 'Find defects and reduce the risk of failure in production',
    wrong: ['Prove that the software has no defects at all', "Fix the bugs in the developers' code", 'Make sure the project is delivered on schedule'] },
  { n: 4, tag: T.FUND, q: 'Static testing is done:',
    key: 'C', answer: 'Without executing the code, by reviewing documents and code',
    wrong: ['By executing the code with different sets of test data', 'Only after the application is deployed to production', 'Using automated tools that run the application under load'] },
  { n: 5, tag: T.FUND, q: 'Which testing principle says that testing every input and path is not possible?',
    key: 'B', answer: 'Exhaustive testing is impossible',
    wrong: ['Defects cluster together', 'Early testing saves time and money', 'Absence-of-errors fallacy'] },

  { n: 6, tag: T.REQ, q: 'Which document maps each requirement to its test cases?',
    key: 'C', answer: 'Requirement Traceability Matrix (RTM)', wrong: ['Test summary report', 'Bug report', 'Test closure report'] },
  { n: 7, tag: T.REQ, q: 'Acceptance criteria in a user story define:',
    key: 'D', answer: 'The conditions the feature must meet to be accepted',
    wrong: ['The technical design of the feature', 'The order in which developers write the code', 'The number of testers needed for the sprint'] },
  { n: 8, tag: T.REQ, q: 'Which item is usually NOT part of a test plan?',
    key: 'B', answer: 'Source code of the application',
    wrong: ['Test scope and objectives', 'Entry and exit criteria', 'Test schedule and resources'] },
  { n: 9, tag: T.REQ, q: 'Risk-based testing means:',
    key: 'C', answer: 'Prioritising tests by likelihood and impact of failure',
    wrong: ['Testing only the features developers say are risky', 'Running all test cases in a random order', 'Testing only after release, once real risks are known'] },
  { n: 10, tag: T.REQ, q: 'A test strategy is typically:',
    key: 'D', answer: 'A high-level document describing the overall testing approach',
    wrong: ['A step-by-step list of test cases for one module', 'A record of the defects found during test execution', 'A script used to automate the regression suite'] },

  { n: 11, tag: T.DESIGN, q: 'A field accepts values from 1 to 100. Which set contains the boundary values?',
    key: 'B', answer: '0, 1, 100, 101', wrong: ['1, 50, 100', '2, 50, 99', '-1, 0, 50, 200'] },
  { n: 12, tag: T.DESIGN, q: 'Equivalence partitioning helps to:',
    key: 'D', answer: 'Reduce test cases by grouping inputs that behave the same',
    wrong: ['Find the exact value at which a defect occurs', 'Test every possible input value one by one', 'Measure the code coverage of a module'] },
  { n: 13, tag: T.DESIGN, q: 'Which technique is best for testing combinations of business rules?',
    key: 'C', answer: 'Decision table testing', wrong: ['Boundary value analysis', 'Equivalence partitioning', 'State transition testing'] },
  { n: 14, tag: T.DESIGN, q: 'State transition testing is most useful for:',
    key: 'C', answer: 'Features whose behaviour depends on current state, such as order status',
    wrong: ['Checking spelling and layout on static pages', 'Measuring the response time of an API', 'Validating the length limit of a single input field'] },
  { n: 15, tag: T.DESIGN, q: "Designing tests based on the tester's experience of where defects are likely is called:",
    key: 'D', answer: 'Error guessing', wrong: ['Boundary value analysis', 'Statement coverage', 'Pairwise testing'] },

  { n: 16, tag: T.DEFECT, q: 'A defect that crashes the application during checkout is usually:',
    key: 'A', answer: 'High severity, high priority', wrong: ['Low severity, high priority', 'High severity, low priority', 'Low severity, low priority'] },
  { n: 17, tag: T.DEFECT, q: 'Severity is usually set by ___, and priority by ___.',
    key: 'A', answer: 'QA / business or product owner',
    wrong: ['Business or product owner / QA', 'Developer / end user', 'End user / developer'] },
  { n: 18, tag: T.DEFECT, q: 'If a fixed defect still occurs during retesting, its status becomes:',
    key: 'B', answer: 'Reopened', wrong: ['Closed', 'Deferred', 'Rejected'] },
  { n: 19, tag: T.DEFECT, q: 'Which bug report field matters most for a developer to reproduce the issue?',
    key: 'B', answer: 'Steps to reproduce', wrong: ['Bug ID', 'Reporter name', 'Date reported'] },
  { n: 20, tag: T.DEFECT, q: 'Defect density is calculated as:',
    key: 'D', answer: 'Number of defects divided by the size of the module',
    wrong: ['Number of defects divided by the number of testers', 'Number of test cases divided by the number of defects', 'Number of fixed defects divided by the total defects'] },

  { n: 21, tag: T.FUNC, q: 'Which testing is done on a new build to decide whether it is stable enough for further testing?',
    key: 'A', answer: 'Smoke testing', wrong: ['Regression testing', 'Acceptance testing', 'Exploratory testing'] },
  { n: 22, tag: T.FUNC, q: 'Sanity testing is:',
    key: 'B', answer: 'A narrow check that a specific fix or change works',
    wrong: ['A full run of every test case in the suite', 'Testing done by end users before go-live', 'Testing the system under heavy user load'] },
  { n: 23, tag: T.FUNC, q: 'User Acceptance Testing (UAT) is mainly performed by:',
    key: 'D', answer: 'Business users or the client', wrong: ['Developers', 'The automation team', 'The database administrator'] },
  { n: 24, tag: T.FUNC, q: 'System testing is performed on:',
    key: 'B', answer: 'The complete, integrated application against requirements',
    wrong: ['Individual functions in isolation', 'Only the database layer of the application', 'Two modules connected to each other'] },
  { n: 25, tag: T.FUNC, q: 'Which testing ensures that a bug fix has not affected other parts of the application?',
    key: 'B', answer: 'Regression testing', wrong: ['Smoke testing', 'Unit testing', 'Usability testing'] },

  // ── B. Technical Testing Skills ──────────────────────────────────────────
  { n: 26, tag: T.API, q: 'Which HTTP method is generally used to replace an entire existing resource?',
    key: 'D', answer: 'PUT', wrong: ['GET', 'POST', 'PATCH'] },
  { n: 27, tag: T.API, q: 'HTTP status code 401 means:',
    key: 'A', answer: 'Unauthorized – authentication is missing or failed',
    wrong: ['Forbidden – the user lacks permission for the resource', 'Bad request – the request body is malformed', 'Internal server error – the server failed unexpectedly'] },
  { n: 28, tag: T.API, q: 'HTTP status code 404 means:',
    key: 'A', answer: 'Resource not found', wrong: ['Request successful', 'Internal server error', 'Request timeout'] },
  { n: 29, tag: T.API, q: 'Which HTTP method should NOT change data on the server?',
    key: 'D', answer: 'GET', wrong: ['POST', 'DELETE', 'PUT'] },
  { n: 30, tag: T.API, q: 'In Postman, environment variables are used to:',
    key: 'B', answer: 'Store values like base URL or token and reuse them across requests',
    wrong: ['Change the HTTP method of a request automatically', 'Encrypt the request body before it is sent', 'Generate API documentation from the collection'] },

  { n: 31, tag: T.SQL, q: 'Which SQL clause filters groups formed by the GROUP BY clause?',
    key: 'D', answer: 'HAVING', wrong: ['WHERE', 'ORDER BY', 'DISTINCT'] },
  { n: 32, tag: T.SQL, q: 'Which JOIN returns all rows from the left table and only matching rows from the right table?',
    key: 'A', answer: 'LEFT JOIN', wrong: ['INNER JOIN', 'RIGHT JOIN', 'CROSS JOIN'] },
  { n: 33, tag: T.SQL, q: 'Which query counts the number of rows in the Employee table?',
    key: 'C', answer: 'SELECT COUNT(*) FROM Employee;',
    wrong: ['SELECT SUM(*) FROM Employee;', 'SELECT TOTAL(*) FROM Employee;', 'SELECT ROWS(*) FROM Employee;'] },
  { n: 34, tag: T.SQL, q: 'In SQL Server, which statement removes all rows from a table while retaining its structure and does not support a WHERE clause?',
    key: 'C', answer: 'TRUNCATE TABLE', wrong: ['DELETE FROM', 'DROP TABLE', 'ALTER TABLE'] },
  { n: 35, tag: T.SQL, q: 'A QA engineer mainly uses SQL to:',
    key: 'C', answer: 'Verify that data saved from the UI is correct in the database',
    wrong: ['Design the user interface of the application', 'Write the business logic of the application', 'Configure the web server that hosts the application'] },

  { n: 36, tag: T.AUTO, q: 'Which Selenium locator is generally the most stable when available?',
    key: 'C', answer: 'ID', wrong: ['Absolute XPath', 'Link text', 'Tag name'] },
  { n: 37, tag: T.AUTO, q: 'An explicit wait in Selenium:',
    key: 'A', answer: 'Waits for a specific condition on a specific element',
    wrong: ['Pauses the script for a fixed number of seconds', 'Applies one default timeout to every element lookup', 'Waits for the whole test suite to finish'] },
  { n: 38, tag: T.AUTO, q: 'Which Playwright feature reduces the need for manual waits?',
    key: 'D', answer: 'Auto-waiting', wrong: ['Page Object Model', 'Test fixtures', 'Trace viewer'] },
  { n: 39, tag: T.AUTO, q: 'Data-driven testing means:',
    key: 'A', answer: 'Running the same test with multiple sets of input data',
    wrong: ['Testing only after data is loaded into production', 'Testing the structure of the database schema', 'Entering test data manually through the UI'] },
  { n: 40, tag: T.AUTO, q: 'Which test is the best candidate for automation?',
    key: 'A', answer: 'A stable regression test run every release',
    wrong: ['A one-time test for a feature being removed next week', 'A usability check of a new screen design', 'An exploratory session on a brand-new feature'] },

  { n: 41, tag: T.FRAME, q: 'In the Page Object Model, a page class contains:',
    key: 'A', answer: 'The locators and actions of that page',
    wrong: ['The assertions for every test in the suite', 'The test data for the whole suite', 'Only the browser driver configuration'] },
  { n: 42, tag: T.FRAME, q: 'Why keep test data and URLs in configuration files instead of hard-coding them?',
    key: 'C', answer: 'They can be changed per environment without editing code',
    wrong: ['Tests run faster when values are read from files', 'Selenium cannot read values written in the code', 'It hides the values from the test report'] },
  { n: 43, tag: T.FRAME, q: 'Which tools are commonly used for automation test reports?',
    key: 'C', answer: 'Extent Reports / Allure', wrong: ['Jira / Confluence', 'Git / GitHub', 'Docker / Kubernetes'] },
  { n: 44, tag: T.FRAME, q: 'In TestNG, which annotation marks a test method?',
    key: 'C', answer: '@Test', wrong: ['@BeforeMethod', '@DataProvider', '@AfterClass'] },
  { n: 45, tag: T.FRAME, q: 'Keeping automation code in Git mainly helps to:',
    key: 'A', answer: 'Track changes, review code and collaborate',
    wrong: ['Run the tests faster in parallel', 'Generate test reports automatically', 'Remove the need for a test framework'] },

  // ── C. Specialised & Modern QA ───────────────────────────────────────────
  { n: 46, tag: T.PERF, q: 'Load testing checks the system:',
    key: 'D', answer: 'Under the expected user load',
    wrong: ['With a single user only', 'Beyond its breaking point', 'After a sudden spike of users'] },
  { n: 47, tag: T.PERF, q: 'Stress testing aims to:',
    key: 'A', answer: 'Find the breaking point beyond normal load',
    wrong: ['Verify the UI layout on different browsers', 'Check behaviour under the expected load only', 'Measure performance over a long, steady period'] },
  { n: 48, tag: T.PERF, q: 'Which tool is commonly used for performance testing?',
    key: 'B', answer: 'Apache JMeter', wrong: ['Selenium WebDriver', 'Postman', 'Jira'] },
  { n: 49, tag: T.PERF, q: 'Throughput in performance testing means:',
    key: 'A', answer: 'Number of requests processed per unit of time',
    wrong: ['Time taken to respond to a single request', 'Percentage of requests that fail', 'Number of users logged in at the same time'] },
  { n: 50, tag: T.PERF, q: 'Testing with a sudden, sharp increase in users is called:',
    key: 'A', answer: 'Spike testing', wrong: ['Soak testing', 'Volume testing', 'Smoke testing'] },

  { n: 51, tag: T.SEC, q: "Entering ' OR '1'='1 in a login field tests for:",
    key: 'D', answer: 'SQL injection', wrong: ['Cross-Site Scripting (XSS)', 'Session timeout', 'Password strength'] },
  { n: 52, tag: T.SEC, q: 'Cross-Site Scripting (XSS) allows an attacker to:',
    key: 'D', answer: "Run malicious scripts in another user's browser",
    wrong: ["Read the server's file system directly", "Guess users' passwords by brute force", 'Overload the server with requests'] },
  { n: 53, tag: T.SEC, q: 'Authorization checks:',
    key: 'B', answer: 'What an authenticated user is allowed to access',
    wrong: ['Who the user claims to be', 'Whether the password is strong enough', 'Whether the connection is encrypted'] },
  { n: 54, tag: T.SEC, q: 'The OWASP Top 10 is:',
    key: 'D', answer: 'A list of the most critical web application security risks',
    wrong: ['A list of the ten best security testing tools', 'A certification exam for security testers', 'A coding standard for Java applications'] },
  { n: 55, tag: T.SEC, q: 'Which is a good security test for session management?',
    key: 'D', answer: 'Session expires after logout and after timeout',
    wrong: ['The login page loads within two seconds', 'The password field accepts special characters', 'The logo appears on every page after login'] },

  { n: 56, tag: T.CICD, q: 'In CI/CD, automated tests are usually triggered:',
    key: 'D', answer: 'On every code commit or pull request',
    wrong: ['Only once, before the first release', 'Manually, whenever a tester has free time', 'Only after deployment to production'] },
  { n: 57, tag: T.CICD, q: 'What is the primary purpose of a quality gate in a CI/CD pipeline?',
    key: 'D', answer: 'Evaluates predefined quality criteria and can fail a pipeline stage or block deployment when the criteria are not met.',
    wrong: [
      'Deploys the build automatically as soon as the code compiles, without waiting for any test results.',
      'Records how long each pipeline stage takes so that the team can track and report build performance.',
      'Controls which developers are allowed to push code to the main branch of the source repository.',
    ] },
  { n: 58, tag: T.CICD, q: 'Which of these is a CI/CD tool?',
    key: 'A', answer: 'Jenkins', wrong: ['Postman', 'Jira', 'Apache JMeter'] },
  { n: 59, tag: T.CICD, q: 'Running UI tests without opening a visible browser window is called:',
    key: 'A', answer: 'Headless execution', wrong: ['Parallel execution', 'Cross-browser execution', 'Remote execution'] },
  { n: 60, tag: T.CICD, q: 'Why have separate QA, staging and production environments?',
    key: 'C', answer: 'To test changes safely before they reach real users',
    wrong: ['To give each team its own copy of production data', 'To reduce the number of test cases needed', 'To avoid the need for version control'] },

  { n: 61, tag: T.AI, q: 'When using AI tools like Claude or ChatGPT to generate test cases, a QA engineer should:',
    key: 'A', answer: 'Review and validate the output against the requirements',
    wrong: ['Use the generated output directly without changes', 'Avoid AI tools completely for any testing work', 'Send the output to the client before reading it'] },
  { n: 62, tag: T.AI, q: 'Which prompt is most likely to give useful test cases?',
    key: 'B', answer: 'One with the requirement, acceptance criteria and expected format',
    wrong: ['A one-line prompt such as “Write some test cases”', 'One that contains only the name of the feature', 'The longest prompt possible, regardless of its content'] },
  { n: 63, tag: T.AI, q: 'Which data should NOT be pasted into public AI tools?',
    key: 'C', answer: 'Customer personal data and credentials',
    wrong: ['A requirement summary with no confidential details', 'Generic test case templates', 'General questions about testing concepts'] },
  { n: 64, tag: T.AI, q: 'AI tools help QA engineers most with:',
    key: 'B', answer: 'Drafting test cases, test data and automation code faster',
    wrong: ['Replacing the need for any test planning', 'Approving releases without human review', 'Guaranteeing zero defects in production'] },
  { n: 65, tag: T.AI, q: 'An AI-generated automation script fails during its first execution. What should the QA engineer do first?',
    key: 'D', answer: 'Inspect the error messages, execution logs and traces to identify the root cause before modifying the script or its configuration.',
    wrong: [
      'Ask the AI tool to regenerate the entire script straight away, without reading the error that was reported.',
      'Increase every wait and timeout in the script to the maximum value and run it again until it passes.',
      'Mark the test as skipped in the suite and continue with the release, since generated scripts are unreliable.',
    ] },

  // ── D. Practical Scenarios ───────────────────────────────────────────────
  { n: 66, tag: T.E2E, q: 'A critical bug is found one hour before release. The best action is to:',
    key: 'B', answer: 'Report it immediately with evidence and impact so the team can decide',
    wrong: ['Stay quiet and log it after the release to avoid a delay', 'Fix the code yourself and deploy it without review', 'Stop the release on your own without informing anyone'] },
  { n: 67, tag: T.E2E, q: 'Which of the following represents the correct sequence of Software Testing Life Cycle (STLC) activities?',
    key: 'B', answer: 'Requirement Analysis → Test Planning → Test Case Development → Test Environment Setup → Test Execution → Test Cycle Closure.',
    wrong: [
      'Test Planning → Requirement Analysis → Test Execution → Test Case Development → Test Environment Setup → Test Cycle Closure.',
      'Requirement Analysis → Test Case Development → Test Execution → Test Planning → Test Environment Setup → Test Cycle Closure.',
      'Test Environment Setup → Requirement Analysis → Test Planning → Test Execution → Test Case Development → Test Cycle Closure.',
    ] },
  { n: 68, tag: T.E2E, q: 'A login page must lock the account after 5 failed attempts. Which test is most important?',
    key: 'A', answer: 'Enter a wrong password 5 times and verify the account is locked',
    wrong: ['Enter the correct password once and verify that login works', 'Check that the password field masks the typed characters', 'Verify that the login button uses the correct colour'] },
  { n: 69, tag: T.E2E, q: 'After placing an order through the UI in an end-to-end test, what should you also verify?',
    key: 'B', answer: 'The order is saved correctly in the database and the API returns the right status',
    wrong: ['The page title stays the same after the order is placed', 'The browser cache is cleared after the order is placed', 'The order page displays correctly at every screen resolution'] },
  { n: 70, tag: T.E2E, q: 'Which document summarises the testing results at the end of a test cycle?',
    key: 'B', answer: 'Test summary report', wrong: ['Test plan', 'Requirement Traceability Matrix', 'Bug report'] },
]

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']

function build(e: Entry) {
  const wrong = [...e.wrong]
  const opts = LETTERS.map(l => (l === e.key ? e.answer : wrong.shift()!))
  return {
    area: AREA,
    questionText: e.q,
    optionA: opts[0], optionB: opts[1], optionC: opts[2], optionD: opts[3],
    correctAnswer: e.key,
    weightage: 1,
    difficulty: 'MEDIUM',
    tags: [e.tag],
    isActive: true,
  }
}

/** Every invariant the bank relies on, asserted on the rows that will actually be written. */
function validate(rows: ReturnType<typeof build>[]) {
  const errors: string[] = []
  if (ENTRIES.length !== 70) errors.push(`expected 70 entries, got ${ENTRIES.length}`)
  ENTRIES.forEach((e, i) => { if (e.n !== i + 1) errors.push(`entry ${i} is numbered ${e.n}, expected ${i + 1}`) })

  const perTag: Record<string, number> = {}
  rows.forEach((r, i) => {
    const e = ENTRIES[i]
    const opts = [r.optionA, r.optionB, r.optionC, r.optionD]
    // The real invariant: the option at the key letter IS the key's answer text.
    const atKey = opts[LETTERS.indexOf(r.correctAnswer as Letter)]
    if (atKey !== e.answer) errors.push(`Q${e.n}: option ${r.correctAnswer} is "${atKey}", key says "${e.answer}"`)
    if (opts.some(o => typeof o !== 'string' || o.trim() === '')) errors.push(`Q${e.n}: empty or undefined option`)
    if (new Set(opts.map(o => o.trim().toLowerCase())).size !== 4) errors.push(`Q${e.n}: duplicate options`)
    if (opts.filter(o => o === e.answer).length !== 1) errors.push(`Q${e.n}: key text appears ${opts.filter(o => o === e.answer).length} times`)
    if (/all of the above|none of (these|the above)|both [a-d] and [a-d]/i.test(opts.join('|'))) errors.push(`Q${e.n}: position-dependent option`)
    perTag[e.tag] = (perTag[e.tag] ?? 0) + 1
  })
  if (new Set(rows.map(r => r.questionText)).size !== rows.length) errors.push('duplicate question text')
  for (const tag of Object.values(T)) if (perTag[tag] !== 5) errors.push(`tag "${tag}" has ${perTag[tag] ?? 0} questions, expected 5`)
  return errors
}

function reviewMarkdown(rows: ReturnType<typeof build>[]) {
  const lines = ['# QA Engineering – 70 questions to be inserted', '',
    `Area: ${AREA} · Difficulty: MEDIUM · Marks: 1 each (70 total). ✔ marks the correct option (from the answer key).`, '']
  let lastTag = ''
  rows.forEach((r, i) => {
    const e = ENTRIES[i]
    if (e.tag !== lastTag) { lines.push(`## ${e.tag}`, ''); lastTag = e.tag }
    lines.push(`**Q${e.n}. ${r.questionText}**`, '')
    const opts = [r.optionA, r.optionB, r.optionC, r.optionD]
    LETTERS.forEach((l, j) => lines.push(`- ${l}) ${opts[j]}${l === r.correctAnswer ? '  ✔' : ''}`))
    lines.push('')
  })
  const spread = LETTERS.map(l => `${l}: ${rows.filter(r => r.correctAnswer === l).length}`).join(' · ')
  lines.push('---', `Answer-key spread: ${spread}`)
  return lines.join('\n')
}

async function main() {
  const rows = ENTRIES.map(build)
  const errors = validate(rows)
  if (errors.length) {
    console.error('Validation failed - nothing written:\n  ' + errors.join('\n  '))
    process.exit(1)
  }

  const host = (CONNECTION ?? '').replace(/^.*@/, '').replace(/\/.*$/, '')
  console.log(`Target: ${host}`)
  console.log(`Validated ${rows.length} questions: key text at key letter, 4 distinct options, 5 per sub-topic.`)
  console.log('Answer-key spread:', LETTERS.map(l => `${l}=${rows.filter(r => r.correctAnswer === l).length}`).join(' '))

  const existing = await prisma.question.findMany({ where: { area: AREA }, select: { questionText: true } })
  const have = new Set(existing.map(q => q.questionText))
  const toInsert = rows.filter(r => !have.has(r.questionText))
  console.log(`Already in bank: ${rows.length - toInsert.length} · To insert: ${toInsert.length} · QA_ENGINEERING rows now: ${existing.length}`)

  if (REVIEW_PATH) {
    writeFileSync(REVIEW_PATH, reviewMarkdown(rows), 'utf8')
    console.log(`Review file written: ${REVIEW_PATH}`)
  }

  if (!CONFIRM) {
    console.log('\nDry run - nothing written. Re-run with --yes to insert.')
    return
  }

  const result = await prisma.question.createMany({ data: toInsert })
  console.log(`Inserted ${result.count}.`)

  // Read back what is actually stored and compare field by field.
  const stored = await prisma.question.findMany({ where: { area: AREA } })
  const byText = new Map(stored.map(q => [q.questionText, q]))
  const mismatches = rows.filter(r => {
    const s = byText.get(r.questionText)
    return !s || s.optionA !== r.optionA || s.optionB !== r.optionB || s.optionC !== r.optionC ||
      s.optionD !== r.optionD || s.correctAnswer !== r.correctAnswer || s.weightage !== 1 ||
      s.difficulty !== 'MEDIUM' || s.tags[0] !== r.tags[0] || !s.isActive
  })
  if (mismatches.length) {
    console.error(`READ-BACK MISMATCH on ${mismatches.length} rows:`, mismatches.map(m => m.questionText))
    process.exit(1)
  }
  console.log(`Read-back verified: all ${rows.length} rows match field by field (${stored.length} QA_ENGINEERING rows total).`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
