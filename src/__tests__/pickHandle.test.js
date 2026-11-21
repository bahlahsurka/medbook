import { pickHandle } from '../components/visualization/pickHandle';

describe('pickHandle', () => {
  test('picks the dominant horizontal direction', () => {
    expect(pickHandle(100, 10)).toBe('right');
    expect(pickHandle(-100, 10)).toBe('left');
  });

  test('picks the dominant vertical direction', () => {
    expect(pickHandle(10, 100)).toBe('bottom');
    expect(pickHandle(10, -100)).toBe('top');
  });

  test('ties favor horizontal', () => {
    expect(pickHandle(50, 50)).toBe('right');
  });
});
