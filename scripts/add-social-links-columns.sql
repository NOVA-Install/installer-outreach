-- Add social media URL columns to marketing_signals table
ALTER TABLE marketing_signals ADD COLUMN IF NOT EXISTS facebook_url TEXT;
ALTER TABLE marketing_signals ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE marketing_signals ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE marketing_signals ADD COLUMN IF NOT EXISTS twitter_url TEXT;
ALTER TABLE marketing_signals ADD COLUMN IF NOT EXISTS youtube_url TEXT;
