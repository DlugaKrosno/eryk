import React, { useState, useEffect } from 'react';
import { view } from '@forge/bridge';

// Import user app (formularz)
import UserApp from './App';

// Import admin app (panel administracyjny)
import AdminApp from './admin/App';

function SmartApp() {
  const [isAdminPage, setIsAdminPage] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const detectContext = async () => {
      try {
        // Panel konfiguracji działa tylko na stronie administracyjnej Jiry, reszta to formularz alertu
        const context = await view.getContext();
        setIsAdminPage(context?.extension?.type === 'jira:adminPage');
      } catch (err) {
        console.error('SmartApp - Error detecting context:', err);
        setIsAdminPage(false);
      }
      setLoading(false);
    };

    detectContext();
  }, []);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{ fontSize: '18px', fontWeight: '500' }}>Ładowanie drEryk Alert...</div>
        <div style={{ fontSize: '14px', color: '#666' }}>Wykrywanie kontekstu...</div>
      </div>
    );
  }
  
  // Strona administracyjna Jiry -> panel konfiguracji; strona projektu i globalna -> formularz alertu
  return isAdminPage ? <AdminApp /> : <UserApp />;
}

export default SmartApp;
