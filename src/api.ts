/**
 * API client for the application.
 */

interface User {
  id: number;
  name: string;
  email: string;
}

interface Product {
  id: number;
  name: string;
  price: number;
  description?: string;
}

interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

class ApiClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.headers = {
      "Content-Type": "application/json",
    };
  }

  setAuthToken(token: string): void {
    this.headers["Authorization"] = `Bearer ${token}`;
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "GET",
      headers: this.headers,
    });
    return response.json();
  }

  async post<T>(endpoint: string, data: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async getUsers(): Promise<User[]> {
    const response = await this.get<User[]>("/users");
    return response.data;
  }

  async getProducts(): Promise<Product[]> {
    const response = await this.get<Product[]>("/products");
    return response.data;
  }

  async createUser(user: Omit<User, "id">): Promise<User> {
    const response = await this.post<User>("/users", user);
    return response.data;
  }
}

export { ApiClient, User, Product, ApiResponse };
