/** Provide the board's monochrome inline SVG icon set. */
import PropTypes from 'prop-types';

const paths = {
  logo: 'M2 18h20M5 18V9l7-4 7 4v9M9 18v-5h6v5M12 2v3',
  search: 'M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  chevron: 'm6 9 6 6 6-6',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  close: 'm6 6 12 12M18 6 6 18',
  guide: 'M9 9a3 3 0 1 1 5 2.2c-1.5 1-2 1.8-2 3M12 18h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zm0 9h7v7h-7zm-9 0h7v7H4z',
  pulse: 'M2 12h5l3-7 4 14 3-7h5',
  up: 'M12 20V4m-5 5 5-5 5 5',
  down: 'M12 4v16m-5-5 5 5 5-5',
  Green: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  Amber: 'm12 3 9 9-9 9-9-9Z',
  Red: 'M5 5h14v14H5Z',
};

/** Render a decorative glyph; the surrounding control provides the accessible name. */
export function Icon({name, className}) {
  return (
    <svg aria-hidden="true" className={className} width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

Icon.propTypes = {name: PropTypes.oneOf(Object.keys(paths)).isRequired, className: PropTypes.string};
