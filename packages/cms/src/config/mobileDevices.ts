export interface MobileDevice {
    name: string;
    width: number;
    height: number;
}

export const MOBILE_DEVICES: MobileDevice[] = [
    { name: 'iPhone SE', width: 375, height: 667, },
    { name: 'iPhone 14', width: 390, height: 844, },
    { name: 'iPhone 14 Pro Max', width: 430, height: 932, },
    { name: 'Pixel 7', width: 412, height: 915, },
    { name: 'Samsung Galaxy S23', width: 360, height: 780, },
    { name: 'iPad Mini', width: 768, height: 1024, },
    { name: 'iPad Air', width: 820, height: 1180, },
    { name: 'Custom (400px)', width: 400, height: 812, },
];

export const DEFAULT_MOBILE_DEVICE = MOBILE_DEVICES[1]; // iPhone 14
