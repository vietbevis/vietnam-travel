const test = require('node:test');
const assert = require('node:assert/strict');
const { checkinScan } = require('../public/admin/assets/js/card-admin');

const tourId = '10'.repeat(12);
const orderCode = 'FIXTURE00001';
const departure = '20261205';

function scan({ items, tickets }) {
  return checkinScan({ tourId }, {
    client: {
      openSession: async () => ({ state: 2, cardType: 1, cardId: 'FF'.repeat(16) }),
      askPin: async () => '',
      verifyPin: async () => {},
      readPhotoUrl: async () => '',
      readProfile: async () => ({}),
      readTickets: async () => tickets
    },
    fetch: async () => ({ ok: true, json: async () => ({ code: 'success', items, customer: {} }) })
  });
}

test('G1 check-in requires the same departure and passenger count as the chip ticket', async () => {
  const item = { orderCode, departure, pax: 3, ticketStatus: 'written' };
  const chip = { orderCode, tourId, departure, pax: 3, status: 1 };
  for (const ticket of [chip, { ...chip, departure: '20261204' }, { ...chip, pax: 2 }]) {
    const result = await scan({ items: [item], tickets: [ticket] });
    assert.equal(result.items[0].onCard, ticket === chip);
  }
});

test('G1 check-in rejects ambiguous legacy items sharing one chip key', async () => {
  const item = { orderCode, departure, pax: 3, ticketStatus: 'written', itemIndex: 0 };
  const chip = { orderCode, tourId, departure, pax: 3, status: 1 };
  const result = await scan({ items: [item, { ...item, itemIndex: 1 }], tickets: [chip] });
  assert.deepEqual(result.items.map(row => row.onCard), [false, false]);
});
