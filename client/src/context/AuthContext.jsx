import { createContext, useContext, useState, useEffect } from 'react';
import { resetSocket } from '../api/socket';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]   = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('pg_token'));

  useEffect(() => {
    const stored = localStorage.getItem('pg_user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch (_) {}
    }
  }, []);

  const login = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('pg_token', authToken);
    localStorage.setItem('pg_user', JSON.stringify(userData));
    resetSocket(); // reconnect the shared socket so it carries the new JWT
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('pg_token');
    localStorage.removeItem('pg_user');
    resetSocket();
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuth: !!token }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);