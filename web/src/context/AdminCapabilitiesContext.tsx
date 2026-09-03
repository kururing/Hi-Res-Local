import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { usePlatform } from '../platform';

export interface AdminCapabilitiesContextValue {
  catalogAdmin: boolean;
  loading: boolean;
  refresh(): Promise<void>;
}

const AdminCapabilitiesContext = createContext<AdminCapabilitiesContextValue | null>(null);

export const AdminCapabilitiesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, user } = useAuth();
  const { admin, capabilities } = usePlatform();
  const [catalogAdmin, setCatalogAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!capabilities.adminCatalog || !admin || status !== 'authenticated' || !user) {
      setCatalogAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const fromUser = user.capabilities?.catalog_admin === true
      || user.capabilities?.admin === true
      || user.permissions?.includes('catalog.write') === true;
    try {
      if (fromUser) {
        setCatalogAdmin(true);
      }
      const result = await admin.getCapabilities();
      setCatalogAdmin(result.catalog_admin === true || result.admin === true);
    } catch {
      setCatalogAdmin(fromUser);
    } finally {
      setLoading(false);
    }
  }, [admin, capabilities.adminCatalog, status, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AdminCapabilitiesContextValue>(() => ({
    catalogAdmin,
    loading,
    refresh,
  }), [catalogAdmin, loading, refresh]);

  return (
    <AdminCapabilitiesContext.Provider value={value}>
      {children}
    </AdminCapabilitiesContext.Provider>
  );
};

export function useAdminCapabilities(): AdminCapabilitiesContextValue {
  const value = useContext(AdminCapabilitiesContext);
  if (!value) {
    throw new Error('useAdminCapabilities must be used within AdminCapabilitiesProvider.');
  }
  return value;
}
