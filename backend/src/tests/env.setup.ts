process.env.DATABASE_URL = "file:./test.db";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-key-that-is-at-least-32-chars-long-for-testing";
process.env.JWT_EXPIRES_IN = "1h";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.BCRYPT_ROUNDS = "4";
process.env.UPLOAD_MAX_SIZE = "104857600";