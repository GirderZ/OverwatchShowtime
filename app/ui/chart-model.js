(function (root) {
  function chartPoints(stats, period, start) {
    if (period === 'day') return Array.from({ length: 24 }, (_, hour) => ({
      label: `${String(hour).padStart(2, '0')}:00`, hour, date: null,
      foregroundMs: stats.hours[hour] || 0,
      backgroundMs: Math.max(0, (stats.runningHours?.[hour] || stats.hours[hour] || 0) - (stats.hours[hour] || 0)),
      timestamp: start + hour * 3600000
    }));
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return stats.daily.map(day => ({
      label: period === 'week' ? weekdays[new Date(`${day.date}T12:00:00+08:00`).getUTCDay()] : day.date.slice(8),
      hour: null, date: day.date, timestamp: Date.parse(`${day.date}T00:00:00+08:00`),
      foregroundMs: day.foregroundMs, backgroundMs: Math.max(0, day.runningMs - day.foregroundMs)
    }));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { chartPoints };
  else root.ShowtimeCharts = { chartPoints };
})(typeof window === 'undefined' ? {} : window);
