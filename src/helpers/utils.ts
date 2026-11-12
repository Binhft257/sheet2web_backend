import { compare, hash } from 'bcrypt';
const saltRounds = 10;

export const hashPassword = (plainPassword: string): Promise<string> =>
  hash(plainPassword, saltRounds);

export const comparePasswordHelper = async (
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> => compare(plainPassword, hashedPassword);
