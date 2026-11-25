/** Define the workshop accounts and non-sign-in directory without plaintext credentials. */

/** Freeze JSON-like records recursively so callers cannot modify seed data. */
export function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

export const PERSON = Object.freeze({
  priya: 'NRO-E-10421', marcus: 'NRO-E-10422', elena: 'NRO-E-10423',
  andre: 'NRO-E-10424', jordan: 'NRO-E-10425', samira: 'NRO-E-10426',
  luis: 'NRO-E-22881', helen: 'NRO-E-22894', marco: 'NRO-E-22902', denise: 'NRO-E-23011',
  omar: 'NRO-E-23044', ruth: 'NRO-E-23058', irene: 'NRO-E-23073', noah: 'NRO-E-23088',
});

// Verifiers are hex SHA-256 of the UTF-8 workshop input, not production authentication.
const accounts = [
  ['priya', 'Priya Raman', 'Program Manager', 'Approver', '+1 415 555 0142', '9620059d8806fc4bc236538b291cec65f1cf1438e6bfab854f7403c291ea4ceb'],
  ['marcus', 'Marcus Hale', 'Rollout Manager', 'Operator', '+1 415 555 0176', '195656ca6082bd7fdb89e47abbe579f7e790763220df25d89060b0e312fac3ea'],
  ['elena', 'Elena Voss', 'Site Coordinator', 'Operator', '+1 510 555 0119', '7a0d2763fcfe84ea25beb8545e0dd97ce8c8e9842320a8fd8a86c92642254b67'],
  ['andre', 'Andre Cole', 'Field Dispatcher', 'Operator', '+1 510 555 0164', '800e62ec99d6d720e2e848d4e8b5d795b33e9d9a712291f53efe96b99f1d57f2'],
  ['jordan', 'Jordan Ellis', 'Regional Viewer', 'Viewer', '+1 628 555 0133', 'a022f58d21315e16ab69d6129b9190389d27a4a237bd8f13368fb9bd40b4d85f'],
  ['samira', 'Samira Qureshi', 'Cluster Administrator', 'Facilitator', '+1 628 555 0188', 'ba1a4601f55313b74baa7659dae9e1f3ab8c635c754d14c80942d38c5ade2e5d'],
];

export const USERS = freezeTree(Object.fromEntries(accounts.map(
  ([key, name, title, role, phone, credentialVerifier]) => {
    const id = PERSON[key];
    const email = `${name.toLowerCase().replace(' ', '.')}@harbor-ring.com`;
    return [id, {id, employeeId: id, name, email, title, role, phone, credentialVerifier}];
  },
)));

const contacts = [
  ['luis', 'Luis Ortega', 'Crew lead', 'Harbor Point, Civic Center, Rockridge', '+1 510 555 0148'],
  ['helen', 'Helen Cho', 'Crew lead', 'Jack London, Market DAS, Point Richmond reattempt', '+1 510 555 0173'],
  ['marco', 'Marco Diaz', 'Crew lead', 'Piedmont Ave, Lakeside', '+1 510 555 0194'],
  ['denise', 'Denise Park', 'Permit clerk', null, '+1 510 555 0190'],
  ['omar', 'Omar Shah', 'Materials lead', null, '+1 415 555 0127'],
  ['ruth', 'Ruth Ibarra', 'Utility coordinator', 'Northwind power', '+1 925 555 0160'],
  ['irene', 'Irene Walsh', 'Civic Civil lead', null, '+1 510 555 0122'],
  ['noah', 'Noah Grant', 'Transmission designer', null, '+1 415 555 0184'],
];

export const DIRECTORY = freezeTree(Object.fromEntries(contacts.map(
  ([key, name, role, usage, phone]) => [PERSON[key], {id: PERSON[key], name, role, usage, phone}],
)));
