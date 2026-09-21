import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api/v1",
  timeout: 20_000,
  withCredentials: true,
  headers: { Accept: "application/json" },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error?.message ?? error.message ?? "请求失败";
    return Promise.reject(new Error(message));
  },
);

export async function getApiData<T>(url: string): Promise<T> {
  const response = await apiClient.get<{ data: T }>(url);
  return response.data.data;
}
