import argon2 from 'argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export function createPasswordHasher(testMode: boolean): PasswordHasher {
  const options = {
    type: argon2.argon2id,
    memoryCost: testMode ? 4096 : 19_456,
    timeCost: testMode ? 1 : 2,
    parallelism: 1,
  } as const;

  return {
    hash(password: string) {
      return argon2.hash(password, options);
    },
    verify(hash: string, password: string) {
      return argon2.verify(hash, password);
    },
  };
}
