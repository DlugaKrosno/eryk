import React, { useState, useEffect } from 'react';
import { view } from '@forge/bridge';

function App() {
  const [currentRoute, setCurrentRoute] = useState('/report');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initRouting = async () => {
      try {
        const history = await view.createHistory();
        const pathname = history.location.pathname || '/report';
        console.log('Main router - current pathname:', pathname);
        setCurrentRoute(pathname);
        setLoading(false);

        // Nasłuchuj na zmiany route
        history.listen((location) => {
          console.log('Main router - route changed to:', location.pathname);
          setCurrentRoute(location.pathname);
        });
      } catch (err) {
        console.error('Routing error:', err);
        setCurrentRoute('/report');
        setLoading(false);
      }
    };

    initRouting();
  }, []);

  // Przekierowanie do admina gdy route === /admin
  useEffect(() => {
    if (currentRoute === '/admin' && !loading) {
      const adminUrl = '/jira/apps/14fb3225-4487-4c53-a8be-b887754173fa/bab18856-4ab3-4f38-b3e3-c734449a352a';
      console.log('Przekierowuję do panelu admina:', adminUrl);
      window.location.href = adminUrl;
    }
  }, [currentRoute, loading]);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div>Ładowanie...</div>
      </div>
    );
  }

  // Dla route /admin - pokaż komunikat o przekierowaniu (przekierowanie w useEffect powyżej)
  if (currentRoute === '/admin') {
    return (
      <div style={{ 
        padding: '20px', 
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        maxWidth: '600px',
        margin: '50px auto',
        textAlign: 'center'
      }}>
        <h2>Przekierowywanie do panelu administracyjnego...</h2>
        <p style={{ color: '#666' }}>Proszę czekać...</p>
      </div>
    );
  }

  // Dla route /report lub default - pokaż komunikat (formularz dostępny tylko w kontekście projektu)
  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: '600px',
      margin: '50px auto'
    }}>
      <h2>DrEryk Alert - Zgłoszenie</h2>
      <p>Formularz zgłoszenia jest dostępny w kontekście projektu.</p>
      <p><strong>Jak otworzyć formularz:</strong></p>
      <ol style={{ textAlign: 'left', lineHeight: '1.8' }}>
        <li>Przejdź do dowolnego projektu w Jira</li>
        <li>W menu bocznym projektu znajdź <strong>"DrEryk Alert"</strong></li>
        <li>Kliknij, aby otworzyć formularz zgłoszenia</li>
      </ol>
      <p style={{ marginTop: '30px', padding: '15px', backgroundColor: '#f4f5f7', borderRadius: '4px', fontSize: '14px' }}>
        💡 <strong>Wskazówka:</strong> Panel administracyjny jest dostępny w menu "Twoje aplikacje" → DrEryk Alert → Admin
      </p>
    </div>
  );
}

export default App;
