/** Expose the West Metro palette and UI measurements to feature components. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B1F33', body: '#1F2933', muted: '#52606D', surface: '#F4F6F8',
        card: '#FFFFFF', line: '#E2E8F0', teal: '#0F6E6B', 'teal-ink': '#085854',
        amber: '#8A5A00', 'amber-wash': '#FBF3E4', red: '#9B2C2C', 'red-wash': '#F8EAEA',
        'green-wash': '#E7F4F1', focus: '#1D4E89',
      },
      borderRadius: { card: '10px', control: '8px' },
      fontSize: { meta: ['12px', '1.5'], title: ['20px', '1.3'], kpi: ['28px', '1.15'] },
    },
  },
};
