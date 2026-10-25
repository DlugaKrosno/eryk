import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import FieldMetrics from './FieldMetrics';

function Statistics({ showFlag, projectKey, issueTypeId }) {
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState('30days');
  const [statistics, setStatistics] = useState(null);
  const [filterPriorities, setFilterPriorities] = useState([]);
  const [showPriorityFilter, setShowPriorityFilter] = useState(false);

  useEffect(() => {
    if (projectKey && issueTypeId) {
      loadStatistics();
    }
  }, [projectKey, issueTypeId, timeRange, filterPriorities]);

  const loadStatistics = async () => {
    if (!projectKey || !issueTypeId) return;
    
    try {
      setLoading(true);
      const result = await invoke('getStatistics', {
        projectKey,
        issueTypeId,
        timeRange,
        priorities: filterPriorities.length > 0 ? filterPriorities : null
      });
      
      if (result.success) {
        setStatistics(result.statistics);
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się załadować statystyk');
      }
    } catch (error) {
      console.error('Błąd loadStatistics:', error);
      showFlag('error', 'Błąd', 'Nie udało się załadować statystyk');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ms) => {
    if (!ms || ms === 0) return '-';
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}min`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}min`;
    } else {
      return `${minutes}min`;
    }
  };

  const formatTimeShort = (ms) => {
    if (!ms || ms === 0) return '-';
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h`;
    } else {
      return `${hours}h`;
    }
  };

  if (!projectKey || !issueTypeId) {
    return (
      <div className="message-box message-warning">
        <strong>Brak konfiguracji:</strong> Nie można załadować statystyk. Sprawdź konfigurację projektu.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Ładowanie statystyk...</p>
      </div>
    );
  }

  if (!statistics) {
    return (
      <div className="message-box message-info">
        Brak danych statystycznych dla wybranego okresu.
      </div>
    );
  }

  // Przygotuj dane trendu do wykresu z automatycznym grupowaniem
  const rawTrendEntries = Object.entries(statistics.trend || {}).sort((a, b) => 
    new Date(a[0]) - new Date(b[0])
  );
  
  console.log('Statistics - rawTrendEntries:', rawTrendEntries.length, rawTrendEntries);
  
  // Określ czy grupować po dniach czy miesiącach
  const shouldGroupByMonth = timeRange === '180days';
  
  // Grupuj dane
  const groupedTrendData = {};
  rawTrendEntries.forEach(([date, data]) => {
    const dateObj = new Date(date);
    let groupKey;
    
    if (shouldGroupByMonth) {
      // Grupuj po miesiącach (YYYY-MM)
      groupKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    } else {
      // Grupuj po dniach (YYYY-MM-DD)
      groupKey = date;
    }
    
    if (!groupedTrendData[groupKey]) {
      groupedTrendData[groupKey] = {};
    }
    
    // Sumuj dane dla każdego priorytetu
    Object.entries(data).forEach(([priority, count]) => {
      if (!groupedTrendData[groupKey][priority]) {
        groupedTrendData[groupKey][priority] = 0;
      }
      groupedTrendData[groupKey][priority] += count;
    });
  });
  
  const trendEntries = Object.entries(groupedTrendData).sort((a, b) => 
    a[0].localeCompare(b[0])
  );
  
  const allPriorities = [...new Set(trendEntries.flatMap(([_, data]) => Object.keys(data)))].sort();
  
  // Oblicz maksymalną wartość (największa wartość dla pojedynczego priorytetu, nie suma)
  const maxCount = Math.max(
    ...trendEntries.flatMap(([_, data]) => Object.values(data)),
    1
  );
  
  // Oblicz wartości dla osi Y (5 podziałek)
  const yAxisSteps = 5;
  const yAxisMax = Math.ceil(maxCount * 1.1); // 10% margines na górze
  const yAxisValues = [];
  for (let i = 0; i <= yAxisSteps; i++) {
    yAxisValues.push(Math.round((yAxisMax / yAxisSteps) * i));
  }
  
  console.log('Statistics - trendEntries:', trendEntries.length, trendEntries);
  console.log('Statistics - allPriorities:', allPriorities);
  console.log('Statistics - maxCount:', maxCount);
  console.log('Statistics - yAxisMax:', yAxisMax);

  return (
    <div>
      {/* Wybór przedziału czasowego i filtrów */}
      <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#F4F5F7', borderRadius: '3px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1', minWidth: '200px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px' }}>
            Przedział czasowy:
          </label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              border: '1px solid #DFE1E6',
              borderRadius: '3px',
              width: '100%'
            }}
          >
          <option value="week">Ostatni tydzień</option>
          <option value="month">Ostatni miesiąc</option>
          <option value="30days">Ostatnie 30 dni</option>
          <option value="180days">Ostatnie 180 dni (maksymalny okres)</option>
          </select>
        </div>
        
        {/* Filtr Priorytetów */}
        <div style={{ position: 'relative' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px' }}>
            Priorytet:
          </label>
          <button
            onClick={() => setShowPriorityFilter(!showPriorityFilter)}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              backgroundColor: filterPriorities.length > 0 ? '#0052CC' : 'white',
              color: filterPriorities.length > 0 ? 'white' : '#172B4D',
              border: '1px solid #DFE1E6',
              borderRadius: '3px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: filterPriorities.length > 0 ? '600' : '400',
              boxShadow: showPriorityFilter ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
              minWidth: '150px'
            }}
          >
            <span>Wszystkie {filterPriorities.length > 0 && `(${filterPriorities.length})`}</span>
            <span style={{ fontSize: '10px' }}>{showPriorityFilter ? '▲' : '▼'}</span>
          </button>
          {showPriorityFilter && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              backgroundColor: 'white',
              border: '1px solid #DFE1E6',
              borderRadius: '3px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
              zIndex: 1000,
              minWidth: '200px',
              maxHeight: '250px',
              overflowY: 'auto',
              padding: '8px'
            }}>
              {['Critical', 'Highest', 'Krytyczny', 'High', 'Wysoki', 'Medium', 'Średni', 'Low', 'Niski', 'None'].map(priority => (
                <label 
                  key={priority}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    padding: '6px 8px',
                    borderRadius: '3px',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F4F5F7'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <input
                    type="checkbox"
                    checked={filterPriorities.includes(priority)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFilterPriorities([...filterPriorities, priority]);
                      } else {
                        setFilterPriorities(filterPriorities.filter(p => p !== priority));
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>{priority}</span>
                </label>
              ))}
            </div>
          )}
          {showPriorityFilter && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 999
              }}
              onClick={() => setShowPriorityFilter(false)}
            />
          )}
        </div>
      </div>

      {/* Sekcja SLA */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: '#172B4D', fontSize: '18px', fontWeight: '600' }}>
          📊 SLA
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
          <div style={{ 
            padding: '20px', 
            backgroundColor: 'white', 
            borderRadius: '3px', 
            border: '1px solid #DFE1E6',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#5E6C84', marginBottom: '8px' }}>Średni czas do pierwszego podjęcia</div>
            <div style={{ fontSize: '24px', fontWeight: '600', color: '#0052CC' }}>
              {formatTime(statistics.sla?.avgTimeToFirstAction)}
            </div>
            <div style={{ fontSize: '12px', color: '#5E6C84', marginTop: '4px' }}>
              {statistics.sla?.totalWithFirstAction || 0} alertów
            </div>
          </div>
          <div style={{ 
            padding: '20px', 
            backgroundColor: 'white', 
            borderRadius: '3px', 
            border: '1px solid #DFE1E6',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#5E6C84', marginBottom: '8px' }}>Średni czas do ukończenia</div>
            <div style={{ fontSize: '24px', fontWeight: '600', color: '#0052CC' }}>
              {formatTime(statistics.sla?.avgTimeToResolution)}
            </div>
            <div style={{ fontSize: '12px', color: '#5E6C84', marginTop: '4px' }}>
              {statistics.sla?.totalResolved || 0} ukończonych
            </div>
          </div>
        </div>
      </div>

      {/* Sekcja Czas w statusie */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: '#172B4D', fontSize: '18px', fontWeight: '600' }}>
          ⏱️ Czas w statusie
        </h3>
        <div style={{ 
          backgroundColor: 'white', 
          borderRadius: '3px', 
          border: '1px solid #DFE1E6',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#F4F5F7' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#5E6C84' }}>Status</th>
                <th style={{ padding: '12px', textAlign: 'right', fontSize: '13px', fontWeight: '600', color: '#5E6C84' }}>Średni czas</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(statistics.timeInStatus || {}).length === 0 ? (
                <tr>
                  <td colSpan="2" style={{ padding: '20px', textAlign: 'center', color: '#5E6C84' }}>
                    Brak danych
                  </td>
                </tr>
              ) : (
                Object.entries(statistics.timeInStatus || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, time]) => (
                    <tr key={status} style={{ borderTop: '1px solid #DFE1E6' }}>
                      <td style={{ padding: '12px', fontSize: '14px', color: '#172B4D' }}>{status}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', fontWeight: '500', color: '#172B4D' }}>
                        {formatTimeShort(time)}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sekcja Trend zgłoszeń */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: '#172B4D', fontSize: '18px', fontWeight: '600' }}>
          📈 Trend alertów
        </h3>
        <div style={{ 
          backgroundColor: 'white', 
          borderRadius: '3px', 
          border: '1px solid #DFE1E6',
          padding: '20px'
        }}>
          {trendEntries.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#5E6C84', padding: '40px' }}>
              Brak danych do wyświetlenia
            </div>
          ) : (
            <div>
              {/* Legenda */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {allPriorities.map(priority => {
                  const colors = {
                    'Critical': '#DE350B',
                    'Highest': '#DE350B',
                    'Krytyczny': '#DE350B',
                    'High': '#FF5630',
                    'Wysoki': '#FF5630',
                    'Medium': '#FFAB00',
                    'Średni': '#FFAB00',
                    'Low': '#36B37E',
                    'Niski': '#36B37E',
                    'None': '#5E6C84'
                  };
                  return (
                    <div key={priority} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ 
                        width: '12px', 
                        height: '12px', 
                        backgroundColor: colors[priority] || '#5E6C84',
                        borderRadius: '2px'
                      }}></div>
                      <span style={{ fontSize: '12px', color: '#5E6C84' }}>{priority}</span>
                    </div>
                  );
                })}
              </div>
              
              {/* Wykres z osią Y - przepisany na prostszy sposób */}
              <div style={{ position: 'relative', display: 'flex', gap: '8px', width: '100%' }}>
                {/* Oś Y z miarką */}
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column-reverse', 
                  justifyContent: 'space-between',
                  paddingRight: '8px',
                  minWidth: '50px',
                  width: '50px',
                  height: '300px'
                }}>
                  {yAxisValues.map((value, index) => (
                    <div 
                      key={value}
                      style={{
                        fontSize: '11px',
                        color: '#5E6C84',
                        textAlign: 'right',
                        paddingRight: '4px',
                        borderTop: index > 0 ? '1px dashed #DFE1E6' : 'none',
                        height: `${100 / yAxisSteps}%`,
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'flex-end',
                        paddingTop: index > 0 ? '2px' : '0'
                      }}
                    >
                      {value}
                    </div>
                  ))}
                </div>
                
                {/* Wykres - kolumny obok siebie dla każdego priorytetu */}
                <div style={{ 
                  position: 'relative', 
                  height: '300px', 
                  flex: 1,
                  display: 'flex', 
                  alignItems: 'flex-end', 
                  gap: '4px',
                  borderLeft: '1px solid #DFE1E6',
                  borderBottom: '1px solid #DFE1E6',
                  paddingLeft: '8px',
                  paddingBottom: '25px',
                  paddingRight: '8px',
                  overflowX: 'auto'
                }}>
                  {trendEntries.length > 0 ? trendEntries.map(([dateKey, data]) => {
                    const colors = {
                      'Critical': '#DE350B',
                      'Highest': '#DE350B',
                      'Krytyczny': '#DE350B',
                      'High': '#FF5630',
                      'Wysoki': '#FF5630',
                      'Medium': '#FFAB00',
                      'Średni': '#FFAB00',
                      'Low': '#36B37E',
                      'Niski': '#36B37E',
                      'None': '#5E6C84'
                    };
                    
                    // Formatuj etykietę daty
                    let dateLabel;
                    if (shouldGroupByMonth) {
                      const [year, month] = dateKey.split('-');
                      dateLabel = new Date(year, parseInt(month) - 1, 1).toLocaleDateString('pl-PL', { month: 'short', year: 'numeric' });
                    } else {
                      dateLabel = new Date(dateKey).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
                    }
                    
                    const total = Object.values(data).reduce((sum, val) => sum + val, 0);
                    
                    return (
                      <div 
                        key={dateKey} 
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '2px',
                          position: 'relative',
                          minWidth: `${Math.max(allPriorities.length * 12, 40)}px`,
                          height: '100%'
                        }}
                        title={`${dateLabel}: ${total} alertów`}
                      >
                        {/* Kolumny dla każdego priorytetu */}
                        <div style={{ 
                          display: 'flex', 
                          flexDirection: 'row',
                          alignItems: 'flex-end',
                          gap: '2px',
                          width: '100%',
                          height: '100%',
                          position: 'relative'
                        }}>
                          {allPriorities.map(priority => {
                            const count = data[priority] || 0;
                            const heightPercent = yAxisMax > 0 ? (count / yAxisMax) * 100 : 0;
                            const heightPx = (heightPercent / 100) * 275; // 275px to wysokość dostępna (300px - 25px padding)
                            const color = colors[priority] || '#5E6C84';
                            
                            return (
                              <div
                                key={priority}
                                style={{
                                  flex: 1,
                                  height: `${Math.max(heightPx, count > 0 ? 4 : 0)}px`,
                                  backgroundColor: color,
                                  minWidth: '10px',
                                  borderRadius: '2px 2px 0 0',
                                  position: 'relative'
                                }}
                                title={`${priority}: ${count}`}
                              >
                                {/* Wyświetl liczbę na kolumnie jeśli jest > 0 */}
                                {count > 0 && (
                                  <div style={{
                                    position: 'absolute',
                                    top: '-18px',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    fontSize: '10px',
                                    color: '#172B4D',
                                    fontWeight: '600',
                                    whiteSpace: 'nowrap'
                                  }}>
                                    {count}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* Etykieta daty */}
                        <div style={{ 
                          fontSize: '10px', 
                          color: '#5E6C84', 
                          marginTop: '4px',
                          transform: 'translateX(-50%) rotate(-45deg)',
                          transformOrigin: 'top left',
                          whiteSpace: 'nowrap',
                          position: 'absolute',
                          bottom: '-25px',
                          left: '50%',
                          textAlign: 'center'
                        }}>
                          {dateLabel}
                        </div>
                      </div>
                    );
                  }) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#5E6C84', width: '100%' }}>
                      Brak danych do wyświetlenia
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sekcja Moduł aplikacji */}
      {Object.keys(statistics.modules || {}).length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ marginBottom: '16px', color: '#172B4D', fontSize: '18px', fontWeight: '600' }}>
            🏗️ Moduł aplikacji
          </h3>
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '3px', 
            border: '1px solid #DFE1E6',
            padding: '20px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
              {Object.entries(statistics.modules || {})
                .sort((a, b) => b[1] - a[1])
                .map(([module, count]) => {
                  const total = Object.values(statistics.modules).reduce((sum, val) => sum + val, 0);
                  const percentage = ((count / total) * 100).toFixed(1);
                  return (
                    <div 
                      key={module}
                      style={{ 
                        padding: '16px', 
                        backgroundColor: '#F4F5F7', 
                        borderRadius: '3px',
                        border: '1px solid #DFE1E6'
                      }}
                    >
                      <div style={{ fontSize: '14px', color: '#5E6C84', marginBottom: '8px' }}>{module}</div>
                      <div style={{ fontSize: '24px', fontWeight: '600', color: '#0052CC' }}>{count}</div>
                      <div style={{ fontSize: '12px', color: '#5E6C84', marginTop: '4px' }}>{percentage}%</div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      <FieldMetrics
        showFlag={showFlag}
        projectKey={projectKey}
        issueTypeId={issueTypeId}
        timeRange={timeRange}
      />
    </div>
  );
}

export default Statistics;
