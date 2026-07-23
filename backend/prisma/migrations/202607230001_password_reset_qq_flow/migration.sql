-- Add QQ-verified password reset flow columns to VerificationChallenge
ALTER TABLE "VerificationChallenge" ADD COLUMN "poll_token" TEXT;
ALTER TABLE "VerificationChallenge" ADD COLUMN "qq_verified_at" DATETIME;
ALTER TABLE "VerificationChallenge" ADD COLUMN "reset_token" TEXT;

CREATE UNIQUE INDEX "VerificationChallenge_poll_token_key" ON "VerificationChallenge"("poll_token");
CREATE UNIQUE INDEX "VerificationChallenge_reset_token_key" ON "VerificationChallenge"("reset_token");
