import React, { useState, useEffect } from 'react';
import { view } from '@forge/bridge';

// Import user app (formularz)
import UserApp from './App';

// Import admin app (panel administracyjny)
import AdminApp from './admin/App';

function SmartApp() {
  const [isProjectContext, setIsProjectContext] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const detectContext = async () => {
      try {
        // Pobierz kontekst z Jiry
        const context = await view.getContext();
        console.log('SmartApp - Context from Jira:', context);
        
        // Sprawdź czy jest projekt w kontekście
        const hasProject = !!(
          (context?.extension?.project?.key) ||
          (context?.project?.key)
        );
        
        console.log('SmartApp - Has project context:', hasProject);
        setIsProjectContext(hasProject);
        setLoading(false);
      } catch (err) {
        console.error('SmartApp - Error detecting context:', err);
        // Brak kontekstu projektu = global page = admin
        setIsProjectContext(false);
        setLoading(false);
      }
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
        <div style={{ fontSize: '18px', fontWeight: '500' }}>Ładowanie DrEryk Alert...</div>
        <div style={{ fontSize: '14px', color: '#666' }}>Wykrywanie kontekstu...</div>
      </div>
    );
  }
  
  // Jeśli kontekst projektu → pokaż formularz zgłoszenia
  if (isProjectContext) {
    console.log('SmartApp - Rendering USER FORM (project context)');
    return <UserApp />;
  }
  
  // Jeśli brak kontekstu projektu → pokaż admin panel (bezpośrednio, nie iframe)
  console.log('SmartApp - Rendering ADMIN PANEL (global context)');
  return <AdminApp />;
}

export default SmartApp;
