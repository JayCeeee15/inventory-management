export interface User { id: number; username: string; password?: string; token: string; }
export interface LoginCredentials { username: string; password: string; }
export interface AuthResponse { user: User; token: string; }
