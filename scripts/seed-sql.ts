/**
 * One-off: insert a batch of SQL questions into the Question bank.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-sql.ts          # dry run
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-sql.ts --yes    # insert
 *
 * Writes through DIRECT_URL (session, :5432), not the pgBouncer pooler.
 */
import 'dotenv/config'
import { PrismaClient, AssessmentArea } from '@prisma/client'

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
const CONFIRM = process.argv.includes('--yes')

type Q = {
  questionText: string
  optionA: string; optionB: string; optionC: string; optionD: string
  correctAnswer: 'A' | 'B' | 'C' | 'D'
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
}

const QUESTIONS: Q[] = [
  { questionText: 'What is the purpose of a Common Table Expression (CTE) in SQL?', optionA: 'To create a permanent table', optionB: 'To define a temporary result set for a query', optionC: 'To index a column', optionD: 'To sort the result set', correctAnswer: 'B', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL function is used to assign a rank to each row within a partition of a result set?', optionA: 'ROW_NUMBER', optionB: 'DENSE_RANK', optionC: 'RANK', optionD: 'NTILE', correctAnswer: 'C', difficulty: 'MEDIUM' },
  { questionText: 'What does the ROW_NUMBER() function do in SQL?', optionA: 'Assigns a unique sequential number to each row', optionB: 'Counts the total number of rows', optionC: 'Groups rows by a column', optionD: 'Filters rows based on a condition', correctAnswer: 'A', difficulty: 'EASY' },
  { questionText: 'Which clause is required when using window functions like RANK()?', optionA: 'GROUP BY', optionB: 'HAVING', optionC: 'WHERE', optionD: 'OVER', correctAnswer: 'D', difficulty: 'MEDIUM' },
  { questionText: 'What is the main difference between RANK() and DENSE_RANK()?', optionA: 'RANK() assigns unique numbers; DENSE_RANK() allows duplicates', optionB: 'RANK() skips numbers after ties; DENSE_RANK() does not', optionC: 'RANK() is used for sorting; DENSE_RANK() is for grouping', optionD: 'RANK() works with partitions; DENSE_RANK() does not', correctAnswer: 'B', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL command is used to modify the structure of an existing table?', optionA: 'UPDATE', optionB: 'MODIFY', optionC: 'ALTER', optionD: 'CHANGE', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'What does the PARTITION BY clause do in a window function?', optionA: 'Divides the result set into groups for calculation', optionB: 'Filters rows based on a condition', optionC: 'Sorts the result set', optionD: 'Joins multiple tables', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL function is used to calculate a running total within a partition?', optionA: 'COUNT', optionB: 'AVG', optionC: 'MAX', optionD: 'SUM', correctAnswer: 'D', difficulty: 'MEDIUM' },
  { questionText: 'What is the purpose of the INTERSECT operator in SQL?', optionA: 'Combines all rows from two SELECT statements', optionB: 'Returns rows common to two SELECT statements', optionC: 'Excludes rows from the second SELECT statement', optionD: 'Joins tables based on a condition', correctAnswer: 'B', difficulty: 'MEDIUM' },
  { questionText: 'What does the EXCEPT operator do in SQL?', optionA: 'Combines all rows from two queries', optionB: 'Returns rows common to both queries', optionC: 'Returns rows from the first query not in the second', optionD: 'Groups rows by a column', correctAnswer: 'C', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL clause is used to define a temporary name for a table in a query?', optionA: 'WITH', optionB: 'AS', optionC: 'ALIAS', optionD: 'RENAME', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'What is the purpose of the LEAD function in SQL?', optionA: 'Counts the number of rows in a partition', optionB: "Returns the previous row's value", optionC: 'Sorts the result set', optionD: "Returns the next row's value", correctAnswer: 'D', difficulty: 'MEDIUM' },
  { questionText: 'What is the main advantage of using an index on a frequently queried column?', optionA: 'It reduces data redundancy', optionB: 'It speeds up query execution', optionC: 'It ensures data integrity', optionD: 'It simplifies table joins', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL command is used to create a stored procedure?', optionA: 'CREATE FUNCTION', optionB: 'CREATE TRIGGER', optionC: 'CREATE PROCEDURE', optionD: 'CREATE VIEW', correctAnswer: 'C', difficulty: 'MEDIUM' },
  { questionText: 'What is the purpose of a trigger in SQL?', optionA: 'To automatically execute code in response to table events', optionB: 'To create a new table', optionC: 'To optimize query performance', optionD: 'To combine multiple SELECT statements', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'What does the LAG function do in SQL?', optionA: "Returns the next row's value", optionB: 'Calculates the average of a partition', optionC: 'Assigns a rank to each row', optionD: "Returns the previous row's value", correctAnswer: 'D', difficulty: 'MEDIUM' },
  { questionText: 'What is the purpose of the NULLIF function in SQL?', optionA: 'Combines two strings', optionB: 'Returns NULL if two expressions are equal', optionC: 'Counts NULL values in a column', optionD: 'Filters rows with NULL values', correctAnswer: 'B', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL clause is used to specify the order of rows in a window function?', optionA: 'GROUP BY', optionB: 'PARTITION BY', optionC: 'ORDER BY', optionD: 'HAVING', correctAnswer: 'C', difficulty: 'MEDIUM' },
  { questionText: 'What is the main disadvantage of overusing indexes in a database?', optionA: 'Increased storage and slower write operations', optionB: 'Slower query execution', optionC: 'Reduced data integrity', optionD: 'Inability to join tables', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'What is the purpose of the MERGE statement in SQL?', optionA: 'To create a new table', optionB: 'To sort the result set', optionC: 'To delete rows from multiple tables', optionD: 'To combine INSERT, UPDATE, and DELETE operations', correctAnswer: 'D', difficulty: 'HARD' },
  { questionText: 'Which cloud platform offers Azure SQL Database as a managed database service?', optionA: 'AWS', optionB: 'Microsoft Azure', optionC: 'Google Cloud', optionD: 'Oracle Cloud', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL feature is widely used in modern analytics and reporting queries?', optionA: 'DELETE', optionB: 'DROP', optionC: 'Window Functions', optionD: 'TRUNCATE', correctAnswer: 'C', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL command is commonly used to improve database query performance?', optionA: 'CREATE INDEX', optionB: 'CREATE VIEW', optionC: 'CREATE USER', optionD: 'CREATE ROLE', correctAnswer: 'A', difficulty: 'EASY' },
  { questionText: 'Which database is popularly used for cloud-based data warehousing?', optionA: 'SQLite', optionB: 'MariaDB', optionC: 'MS Access', optionD: 'Snowflake', correctAnswer: 'D', difficulty: 'EASY' },
  { questionText: 'Which SQL keyword is used to retrieve only unique records?', optionA: 'UNIQUE', optionB: 'DISTINCT', optionC: 'DIFFERENT', optionD: 'FILTER', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL statement is used in data engineering pipelines for transforming data?', optionA: 'PRINT', optionB: 'DISPLAY', optionC: 'SELECT', optionD: 'REMOVE', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which SQL join returns matching records from both tables only?', optionA: 'INNER JOIN', optionB: 'LEFT JOIN', optionC: 'FULL JOIN', optionD: 'CROSS JOIN', correctAnswer: 'A', difficulty: 'EASY' },
  { questionText: 'Which SQL database is developed by Oracle Corporation?', optionA: 'PostgreSQL', optionB: 'MongoDB', optionC: 'Cassandra', optionD: 'Oracle Database', correctAnswer: 'D', difficulty: 'EASY' },
  { questionText: 'Which SQL function is commonly used in business intelligence dashboards?', optionA: 'DELETE', optionB: 'SUM', optionC: 'DROP', optionD: 'RENAME', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL clause is mainly used for data filtering in analytics queries?', optionA: 'ORDER BY', optionB: 'GROUP BY', optionC: 'WHERE', optionD: 'LIMIT', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which modern SQL database is known for strong JSON support?', optionA: 'PostgreSQL', optionB: 'SQLite', optionC: 'FoxPro', optionD: 'dBase', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL keyword is used with aggregate functions for grouped records?', optionA: 'SORT BY', optionB: 'FILTER BY', optionC: 'ORDER BY', optionD: 'GROUP BY', correctAnswer: 'D', difficulty: 'EASY' },
  { questionText: 'Which SQL operation is commonly optimized using partitioning?', optionA: 'Printing reports', optionB: 'Large table queries', optionC: 'Creating passwords', optionD: 'User login', correctAnswer: 'B', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL platform is widely used in enterprise-level applications?', optionA: 'MS Paint', optionB: 'Notepad', optionC: 'SQL Server', optionD: 'Canva', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which SQL statement is used to create reusable query logic?', optionA: 'VIEW', optionB: 'DELETE', optionC: 'DROP', optionD: 'REMOVE', correctAnswer: 'A', difficulty: 'EASY' },
  { questionText: 'Which SQL keyword is used to sort query results?', optionA: 'FILTER', optionB: 'ALIGN', optionC: 'GROUP', optionD: 'ORDER BY', correctAnswer: 'D', difficulty: 'EASY' },
  { questionText: 'Which SQL concept helps maintain data accuracy and consistency?', optionA: 'Themes', optionB: 'Constraints', optionC: 'Templates', optionD: 'Widgets', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL function is useful for handling NULL values?', optionA: 'COALESCE', optionB: 'COUNT', optionC: 'MAX', optionD: 'SUM', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL command is commonly used in ETL processes to load data?', optionA: 'FETCH', optionB: 'PRINT', optionC: 'INSERT', optionD: 'REMOVE', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which SQL keyword is used to rename columns temporarily?', optionA: 'RENAME', optionB: 'CHANGE', optionC: 'MODIFY', optionD: 'AS', correctAnswer: 'D', difficulty: 'EASY' },
  { questionText: 'Which SQL database is highly popular for open-source web applications?', optionA: 'Oracle', optionB: 'MySQL', optionC: 'IBM DB2', optionD: 'Teradata', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL command removes duplicate rows from query results?', optionA: 'DISTINCT', optionB: 'DELETE', optionC: 'REMOVE', optionD: 'TRUNCATE', correctAnswer: 'A', difficulty: 'EASY' },
  { questionText: 'Which SQL clause is used after GROUP BY to filter grouped data?', optionA: 'WHERE', optionB: 'ORDER BY', optionC: 'HAVING', optionD: 'LIMIT', correctAnswer: 'C', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL function is used for ranking rows in analytics?', optionA: 'AVG', optionB: 'SUM', optionC: 'COUNT', optionD: 'RANK', correctAnswer: 'D', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL concept is important for ACID compliance?', optionA: 'Transactions', optionB: 'Themes', optionC: 'Widgets', optionD: 'Templates', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL operator checks for values within a given range?', optionA: 'EXISTS', optionB: 'BETWEEN', optionC: 'LIKE', optionD: 'IN', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL statement is commonly used in AI-powered analytics systems?', optionA: 'DELETE', optionB: 'DROP', optionC: 'SELECT', optionD: 'REMOVE', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which SQL feature helps automate database actions?', optionA: 'Views', optionB: 'Indexes', optionC: 'Constraints', optionD: 'Triggers', correctAnswer: 'D', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL keyword is used for pattern matching?', optionA: 'EXISTS', optionB: 'LIKE', optionC: 'RANGE', optionD: 'FIND', correctAnswer: 'B', difficulty: 'EASY' },
  { questionText: 'Which SQL statement is used to permanently save transaction changes?', optionA: 'COMMIT', optionB: 'ROLLBACK', optionC: 'CANCEL', optionD: 'SAVEPOINT', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL database is commonly used with Python and Django applications?', optionA: 'Excel', optionB: 'Firebase', optionC: 'PostgreSQL', optionD: 'Redis', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which SQL command is used to remove all records while keeping the table structure?', optionA: 'DROP', optionB: 'TRUNCATE', optionC: 'REMOVE', optionD: 'CLEAR', correctAnswer: 'B', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL keyword is used to combine records from multiple tables?', optionA: 'MERGE', optionB: 'CONNECT', optionC: 'MATCH', optionD: 'JOIN', correctAnswer: 'D', difficulty: 'EASY' },
  { questionText: 'Which SQL object stores reusable business logic inside the database?', optionA: 'Stored Procedure', optionB: 'Index', optionC: 'Trigger', optionD: 'Constraint', correctAnswer: 'A', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL clause is used to limit returned rows in MySQL?', optionA: 'TOP', optionB: 'FETCH', optionC: 'LIMIT', optionD: 'RANGE', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which SQL feature is important in real-time analytics and dashboards?', optionA: 'DROP TABLE', optionB: 'Window Functions', optionC: 'DELETE DATABASE', optionD: 'RENAME TABLE', correctAnswer: 'B', difficulty: 'MEDIUM' },
  { questionText: 'Which SQL keyword is used to check for NULL values?', optionA: 'IS NULL', optionB: 'EMPTY', optionC: 'NULLCHECK', optionD: 'CHECK NULL', correctAnswer: 'A', difficulty: 'EASY' },
  { questionText: 'Which SQL database service is offered by Amazon Web Services?', optionA: 'Azure SQL', optionB: 'BigQuery', optionC: 'Snowflake', optionD: 'Amazon RDS', correctAnswer: 'D', difficulty: 'EASY' },
  { questionText: 'Which SQL function is used to calculate total values?', optionA: 'COUNT', optionB: 'AVG', optionC: 'SUM', optionD: 'MIN', correctAnswer: 'C', difficulty: 'EASY' },
  { questionText: 'Which SQL command is used to change existing records in a table?', optionA: 'INSERT', optionB: 'UPDATE', optionC: 'MODIFY', optionD: 'CHANGE', correctAnswer: 'B', difficulty: 'EASY' },
]

async function main() {
  const host = (CONNECTION ?? '').replace(/^.*@/, '').replace(/\/.*$/, '')
  console.log(`target: ${host}`)
  console.log(`questions in file: ${QUESTIONS.length}`)
  const before = await prisma.question.count({ where: { area: AssessmentArea.SQL } })
  console.log(`existing SQL questions: ${before}`)

  if (!CONFIRM) {
    console.log('\nDRY RUN - nothing inserted. Re-run with --yes to execute.')
    return
  }

  const result = await prisma.question.createMany({
    data: QUESTIONS.map(q => ({
      area: AssessmentArea.SQL,
      questionText: q.questionText,
      optionA: q.optionA, optionB: q.optionB, optionC: q.optionC, optionD: q.optionD,
      correctAnswer: q.correctAnswer,
      weightage: 1,
      difficulty: q.difficulty,
      tags: [],
      isActive: true,
    })),
  })

  const after = await prisma.question.count({ where: { area: AssessmentArea.SQL } })
  console.log(`\ninserted: ${result.count}`)
  console.log(`SQL questions now: ${after}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
