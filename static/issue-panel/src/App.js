import React from 'react';
import Lozenge from '@atlaskit/lozenge';

function App() {
  return (
    <div style={{ padding: '15px' }}>
      <h3 style={{ marginBottom: '15px' }}>🚨 Incident Details</h3>
      
      <div style={{ marginBottom: '10px' }}>
        <strong>Calculated Priority:</strong>{' '}
        <Lozenge appearance="red">P1</Lozenge>
      </div>
      
      <div style={{ marginBottom: '10px' }}>
        <strong>Assigned Team:</strong> SRE Team
      </div>
      
      <div style={{ marginBottom: '10px' }}>
        <strong>Rule Applied:</strong> P1 - Production Critical Outage
      </div>
      
      <div style={{ marginTop: '20px', padding: '10px', background: '#F4F5F7', borderRadius: '3px' }}>
        <p style={{ fontSize: '12px', color: '#6B778C', margin: 0 }}>
          ℹ️ This incident was automatically processed by Incident Reporter. 
          Priority and team assignment were determined by configured rules.
        </p>
      </div>
      
      <div style={{ marginTop: '15px' }}>
        <p style={{ fontSize: '12px', color: '#6B778C' }}>
          <strong>Note:</strong> Full incident details are stored in custom fields. 
          Check the issue fields for System, Environment, Category, Impact, and Urgency.
        </p>
      </div>
    </div>
  );
}

export default App;

