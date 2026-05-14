/**
 * Validation utilities for settings inputs
 */

/**
 * Validate E.164 phone number format (e.g., +351912345678)
 */
export function isValidPhoneNumber(phone: string): boolean {
  // E.164 format: +[country code][number] (max 15 digits)
  const regex = /^\+[1-9]\d{7,14}$/;
  return regex.test(phone.trim());
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate API key format (alphanumeric, min length)
 */
export function isValidApiKey(key: string, minLength = 8): boolean {
  return key.length >= minLength && /^[a-zA-Z0-9_-]+$/.test(key);
}

/**
 * Validate Telegram bot token format (numeric:alphabetic pattern)
 */
export function isValidTelegramToken(token: string): boolean {
  // Format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
  const regex = /^\d{6,}:[a-zA-Z0-9_-]+$/;
  return regex.test(token.trim());
}

/**
 * Validate Discord bot token format
 */
export function isValidDiscordToken(token: string): boolean {
  // Modern Discord tokens: base64.b64.b64
  const parts = token.split('.');
  return parts.length === 3 && parts.every(p => p.length > 0);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Validation result type
 */
export type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Validate phone number with error message
 */
export function validatePhoneNumber(phone: string): ValidationResult {
  if (!phone) {
    return { valid: false, error: "Phone number is required" };
  }
  if (!isValidPhoneNumber(phone)) {
    return { valid: false, error: "Must be in E.164 format (e.g., +351912345678)" };
  }
  return { valid: true };
}

/**
 * Validate URL with error message
 */
export function validateUrl(url: string, fieldName = "URL"): ValidationResult {
  if (!url) {
    return { valid: false, error: `${fieldName} is required` };
  }
  if (!isValidUrl(url)) {
    return { valid: false, error: `Invalid ${fieldName.toLowerCase()} format` };
  }
  return { valid: true };
}

/**
 * Validate API key with error message
 */
export function validateApiKey(key: string, provider: string): ValidationResult {
  if (!key) {
    return { valid: false, error: `${provider} API key is required` };
  }
  if (key.length < 8) {
    return { valid: false, error: `API key must be at least 8 characters` };
  }
  return { valid: true };
}

/**
 * Validate Telegram token with error message
 */
export function validateTelegramToken(token: string): ValidationResult {
  if (!token) {
    return { valid: false, error: "Telegram bot token is required" };
  }
  if (!isValidTelegramToken(token)) {
    return { valid: false, error: "Invalid Telegram bot token format (expected: 123456789:ABCdef...)" };
  }
  return { valid: true };
}

/**
 * Validate Discord token with error message
 */
export function validateDiscordToken(token: string): ValidationResult {
  if (!token) {
    return { valid: false, error: "Discord bot token is required" };
  }
  if (!isValidDiscordToken(token)) {
    return { valid: false, error: "Invalid Discord bot token format" };
  }
  return { valid: true };
}
