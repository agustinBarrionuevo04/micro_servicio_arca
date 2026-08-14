process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/arca_billing_test';
process.env['ENCRYPTION_KEY'] = process.env['ENCRYPTION_KEY'] ?? '0'.repeat(64);
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-jwt-secret-not-for-production-use-only-32chars';
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = process.env['PORT'] ?? '3099';
process.env['RATE_LIMIT_MAX'] = '10000';
process.env['RATE_LIMIT_TIME_WINDOW'] = '60000';
