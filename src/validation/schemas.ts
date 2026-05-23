/**
 * Validation Schemas with Zod
 *
 * Centralized validation for all API inputs.
 * Provides type-safe validation with clear error messages.
 */

// Note: Install zod with: bun add zod
// For now, using lightweight validation without external dependencies

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError };

export class ValidationError extends Error {
  constructor(
    message: string,
    public path: string[],
    public code: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Simple validation utilities (Zod-like API without dependency)
 */
export const v = {
  string: {
    required: (value: unknown, path: string[] = []): ValidationResult<string> => {
      if (typeof value !== 'string' || value.trim() === '') {
        return { success: false, error: new ValidationError('Required string', path, 'required') };
      }
      return { success: true, data: value };
    },
    optional: (value: unknown, path: string[] = []): ValidationResult<string | undefined> => {
      if (value === undefined || value === null) {
        return { success: true, data: undefined };
      }
      if (typeof value !== 'string') {
        return { success: false, error: new ValidationError('Expected string', path, 'invalid_type') };
      }
      return { success: true, data: value };
    },
    minLength: (value: string, min: number, path: string[] = []): ValidationResult<string> => {
      if (value.length < min) {
        return {
          success: false,
          error: new ValidationError(`Minimum length is ${min}`, path, 'too_small'),
        };
      }
      return { success: true, data: value };
    },
    maxLength: (value: string, max: number, path: string[] = []): ValidationResult<string> => {
      if (value.length > max) {
        return {
          success: false,
          error: new ValidationError(`Maximum length is ${max}`, path, 'too_big'),
        };
      }
      return { success: true, data: value };
    },
    email: (value: string, path: string[] = []): ValidationResult<string> => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return { success: false, error: new ValidationError('Invalid email format', path, 'invalid') };
      }
      return { success: true, data: value };
    },
    url: (value: string, path: string[] = []): ValidationResult<string> => {
      try {
        new URL(value);
        return { success: true, data: value };
      } catch {
        return { success: false, error: new ValidationError('Invalid URL format', path, 'invalid') };
      }
    },
  },

  number: {
    required: (value: unknown, path: string[] = []): ValidationResult<number> => {
      if (typeof value !== 'number' || isNaN(value)) {
        return { success: false, error: new ValidationError('Required number', path, 'required') };
      }
      return { success: true, data: value };
    },
    optional: (value: unknown, path: string[] = []): ValidationResult<number | undefined> => {
      if (value === undefined || value === null) {
        return { success: true, data: undefined };
      }
      if (typeof value !== 'number' || isNaN(value)) {
        return { success: false, error: new ValidationError('Expected number', path, 'invalid_type') };
      }
      return { success: true, data: value };
    },
    min: (value: number, min: number, path: string[] = []): ValidationResult<number> => {
      if (value < min) {
        return { success: false, error: new ValidationError(`Minimum value is ${min}`, path, 'too_small') };
      }
      return { success: true, data: value };
    },
    max: (value: number, max: number, path: string[] = []): ValidationResult<number> => {
      if (value > max) {
        return { success: false, error: new ValidationError(`Maximum value is ${max}`, path, 'too_big') };
      }
      return { success: true, data: value };
    },
    int: (value: number, path: string[] = []): ValidationResult<number> => {
      if (!Number.isInteger(value)) {
        return { success: false, error: new ValidationError('Must be an integer', path, 'invalid') };
      }
      return { success: true, data: value };
    },
  },

  boolean: {
    required: (value: unknown, path: string[] = []): ValidationResult<boolean> => {
      if (typeof value !== 'boolean') {
        return { success: false, error: new ValidationError('Required boolean', path, 'required') };
      }
      return { success: true, data: value };
    },
    optional: (value: unknown, path: string[] = []): ValidationResult<boolean | undefined> => {
      if (value === undefined || value === null) {
        return { success: true, data: undefined };
      }
      if (typeof value !== 'boolean') {
        return { success: false, error: new ValidationError('Expected boolean', path, 'invalid_type') };
      }
      return { success: true, data: value };
    },
  },

  object: {
    required: (value: unknown, path: string[] = []): ValidationResult<Record<string, unknown>> => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { success: false, error: new ValidationError('Required object', path, 'required') };
      }
      return { success: true, data: value as Record<string, unknown> };
    },
    optional: (value: unknown, path: string[] = []): ValidationResult<Record<string, unknown> | undefined> => {
      if (value === undefined || value === null) {
        return { success: true, data: undefined };
      }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { success: false, error: new ValidationError('Expected object', path, 'invalid_type') };
      }
      return { success: true, data: value as Record<string, unknown> };
    },
  },

  array: {
    required: (value: unknown, path: string[] = []): ValidationResult<unknown[]> => {
      if (!Array.isArray(value)) {
        return { success: false, error: new ValidationError('Required array', path, 'required') };
      }
      return { success: true, data: value };
    },
    minLength: (value: unknown[], min: number, path: string[] = []): ValidationResult<unknown[]> => {
      if (value.length < min) {
        return {
          success: false,
          error: new ValidationError(`Minimum length is ${min}`, path, 'too_small'),
        };
      }
      return { success: true, data: value };
    },
  },

  enum: <T extends string>(value: unknown, enumValues: T[], path: string[] = []): ValidationResult<T> => {
    if (typeof value !== 'string' || !enumValues.includes(value as T)) {
      return {
        success: false,
        error: new ValidationError(`Must be one of: ${enumValues.join(', ')}`, path, 'invalid'),
      };
    }
    return { success: true, data: value as T };
  },

  datetime: (value: string, path: string[] = []): ValidationResult<string> => {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return { success: false, error: new ValidationError('Invalid datetime format', path, 'invalid') };
    }
    return { success: true, data: value };
  },

  uuid: (value: string, path: string[] = []): ValidationResult<string> => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      return { success: false, error: new ValidationError('Invalid UUID format', path, 'invalid') };
    }
    return { success: true, data: value };
  },
};

// --- Pre-defined schemas for common API inputs ---

export const CreateCommitmentSchema = (input: unknown): ValidationResult<{
  what: string;
  when?: string;
  priority?: 'low' | 'medium' | 'high';
}> => {
  const objResult = v.object.required(input, ['body']);
  if (!objResult.success) return objResult;

  const obj = objResult.data;

  const whatResult = v.string.required(obj.what, ['what']);
  if (!whatResult.success) return whatResult;
  const whatValidated = v.string.maxLength(whatResult.data, 500, ['what']);
  if (!whatValidated.success) return whatValidated;

  const whenResult = v.string.optional(obj.when, ['when']);
  if (!whenResult.success) return whenResult;
  if (whenResult.data) {
    const datetimeResult = v.datetime(whenResult.data, ['when']);
    if (!datetimeResult.success) return datetimeResult;
  }

  const priorityResult = v.enum(
    obj.priority as string,
    ['low', 'medium', 'high'],
    ['priority']
  );
  if (!priorityResult.success) return priorityResult;

  return {
    success: true,
    data: {
      what: whatValidated.data,
      when: whenResult.data,
      priority: priorityResult.data as 'low' | 'medium' | 'high',
    },
  };
};

export const CreateGoalSchema = (input: unknown): ValidationResult<{
  title: string;
  description?: string;
  level?: 'strategic' | 'tactical' | 'operational';
  deadline?: string;
}> => {
  const objResult = v.object.required(input, ['body']);
  if (!objResult.success) return objResult;

  const obj = objResult.data;

  const titleResult = v.string.required(obj.title, ['title']);
  if (!titleResult.success) return titleResult;
  const titleValidated = v.string.maxLength(titleResult.data, 200, ['title']);
  if (!titleValidated.success) return titleValidated;

  const descriptionResult = v.string.optional(obj.description, ['description']);
  if (!descriptionResult.success) return descriptionResult;
  if (descriptionResult.data) {
    const descValidated = v.string.maxLength(descriptionResult.data, 2000, ['description']);
    if (!descValidated.success) return descValidated;
  }

  const levelResult = v.enum(
    obj.level as string,
    ['strategic', 'tactical', 'operational'],
    ['level']
  );
  if (!levelResult.success) return levelResult;

  const deadlineResult = v.string.optional(obj.deadline, ['deadline']);
  if (!deadlineResult.success) return deadlineResult;
  if (deadlineResult.data) {
    const datetimeResult = v.datetime(deadlineResult.data, ['deadline']);
    if (!datetimeResult.success) return datetimeResult;
  }

  return {
    success: true,
    data: {
      title: titleValidated.data,
      description: descriptionResult.data,
      level: levelResult.data as 'strategic' | 'tactical' | 'operational',
      deadline: deadlineResult.data,
    },
  };
};

export const CreateEntitySchema = (input: unknown): ValidationResult<{
  type: 'person' | 'project' | 'tool' | 'place' | 'concept' | 'event';
  name: string;
  properties?: Record<string, unknown>;
  source?: string;
}> => {
  const objResult = v.object.required(input, ['body']);
  if (!objResult.success) return objResult;

  const obj = objResult.data;

  const typeResult = v.enum(
    obj.type as string,
    ['person', 'project', 'tool', 'place', 'concept', 'event'],
    ['type']
  );
  if (!typeResult.success) return typeResult;

  const nameResult = v.string.required(obj.name, ['name']);
  if (!nameResult.success) return nameResult;
  const nameValidated = v.string.maxLength(nameResult.data, 200, ['name']);
  if (!nameValidated.success) return nameValidated;

  const propertiesResult = v.object.optional(obj.properties, ['properties']);
  if (!propertiesResult.success) return propertiesResult;

  const sourceResult = v.string.optional(obj.source, ['source']);
  if (!sourceResult.success) return sourceResult;

  return {
    success: true,
    data: {
      type: typeResult.data,
      name: nameValidated.data,
      properties: propertiesResult.data,
      source: sourceResult.data,
    },
  };
};

export const SendMessageSchema = (input: unknown): ValidationResult<{
  text: string;
  threadId?: string;
  images?: { dataUrl: string; mediaType: string }[];
}> => {
  const objResult = v.object.required(input, ['body']);
  if (!objResult.success) return objResult;

  const obj = objResult.data;

  const textResult = v.string.required(obj.text, ['text']);
  if (!textResult.success) return textResult;
  const textValidated = v.string.maxLength(textResult.data, 50000, ['text']);
  if (!textValidated.success) return textValidated;

  const threadIdResult = v.string.optional(obj.threadId, ['threadId']);
  if (!threadIdResult.success) return threadIdResult;

  const imagesResult = v.array.required(obj.images, ['images']);
  if (!imagesResult.success) return imagesResult;

  return {
    success: true,
    data: {
      text: textValidated.data,
      threadId: threadIdResult.data,
      images: imagesResult.data as { dataUrl: string; mediaType: string }[],
    },
  };
};

/**
 * Express-style validation middleware
 */
export function validate<T>(
  schema: (input: unknown) => ValidationResult<T>
): (req: Request) => ValidationResult<T> {
  return (req: Request) => {
    return schema(req);
  };
}
