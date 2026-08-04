/**
 * Demo dealer: Rooftop Demo Motors — two rooftops, two storefronts.
 * Pricing, mileage and cost structure are set to what a PNW independent lot
 * would actually be carrying. Aging is spread across every bucket on purpose.
 */

export type Lot = 'VAN' | 'BG';

export interface SeedVehicle {
  lot: Lot;
  year: number;
  make: string;
  model: string;
  trim: string;
  body: 'SEDAN' | 'SUV' | 'TRUCK' | 'COUPE' | 'HATCHBACK' | 'WAGON' | 'VAN' | 'CONVERTIBLE';
  doors: number;
  engine: string;
  cylinders: number;
  transmission: 'AUTOMATIC' | 'MANUAL' | 'CVT';
  drivetrain: 'FWD' | 'RWD' | 'AWD' | 'FOUR_WD';
  fuel: 'GAS' | 'DIESEL' | 'HYBRID' | 'PLUGIN_HYBRID' | 'ELECTRIC' | 'FLEX';
  mpg: [number, number];
  ext: string;
  hex: string;
  int: string;
  mileage: number;
  price: number;
  salePrice?: number;
  cost: number;
  pack: number;
  recon: number;
  market: number;
  /** days in stock, measured from date-in */
  dis: number;
  /** days from date-in to front-line ready; null = still not front line */
  reconDays: number | null;
  status:
    | 'ARRIVED' | 'IN_RECON' | 'PHOTOS_PENDING' | 'FRONT_LINE_READY' | 'PENDING_SALE';
  source: 'AUCTION' | 'TRADE_IN' | 'STREET_PURCHASE' | 'LEASE_RETURN' | 'DEALER_TRADE';
  oneOwner: boolean;
  noAccidents: boolean;
  options: string[];
  callouts: string[];
  description: string;
}

const S = (...o: string[]) => o;

export const SEED_VEHICLES: SeedVehicle[] = [
  /* ---------------------------------------------------- Vancouver rooftop */
  {
    lot: 'VAN', year: 2021, make: 'Toyota', model: 'RAV4', trim: 'XLE Premium AWD',
    body: 'SUV', doors: 4, engine: '2.5L I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [27, 34],
    ext: 'Magnetic Gray Metallic', hex: '#4a4f55', int: 'Black SofTex',
    mileage: 41280, price: 28995, cost: 25400, pack: 795, recon: 1285, market: 29600,
    dis: 4, reconDays: null, status: 'IN_RECON', source: 'AUCTION',
    oneOwner: true, noAccidents: true,
    options: S('Power Moonroof', 'Blind Spot Monitor', 'Heated Front Seats', 'Power Liftgate', 'Apple CarPlay'),
    callouts: S('Fresh trade-in grade unit', 'Toyota Safety Sense 2.0'),
    description:
      'Clean one-owner RAV4 XLE Premium with the moonroof and power liftgate package. AWD, full Toyota Safety Sense suite, and service records on file. Currently in recon — reserve it now and we will hold it.',
  },
  {
    lot: 'VAN', year: 2019, make: 'Subaru', model: 'Outback', trim: '2.5i Premium AWD',
    body: 'WAGON', doors: 4, engine: '2.5L H4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [25, 32],
    ext: 'Crystal Black Silica', hex: '#15171b', int: 'Slate Black Cloth',
    mileage: 68940, price: 21495, cost: 17900, pack: 795, recon: 1640, market: 21900,
    dis: 9, reconDays: 6, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: true, noAccidents: true,
    options: S('X-Mode', 'EyeSight Driver Assist', 'Heated Seats', 'Roof Rails', 'Backup Camera'),
    callouts: S('One owner', 'New tires all around', 'Records since new'),
    description:
      'The Pacific Northwest default, and for good reason. One-owner Outback Premium with EyeSight, X-Mode and fresh rubber on all four corners. Timing and fluids done in-house before it hit the front line.',
  },
  {
    lot: 'VAN', year: 2018, make: 'Ford', model: 'F-150', trim: 'XLT SuperCrew 4x4',
    body: 'TRUCK', doors: 4, engine: '5.0L V8', cylinders: 8, transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD', fuel: 'GAS', mpg: [17, 23],
    ext: 'Oxford White', hex: '#eef1f4', int: 'Medium Earth Gray Cloth',
    mileage: 96410, price: 28450, cost: 24200, pack: 795, recon: 2180, market: 29100,
    dis: 11, reconDays: 7, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('XLT Chrome Package', 'Trailer Tow Package', 'Spray-In Bedliner', 'Backup Camera', 'Running Boards'),
    callouts: S('5.0L Coyote V8', 'Tow package', 'Priced under market'),
    description:
      'XLT SuperCrew 4x4 with the 5.0L V8 and factory tow package — the configuration everyone actually wants. Spray-in liner, running boards, and a clean frame. Brakes and fluids serviced during recon.',
  },
  {
    lot: 'VAN', year: 2020, make: 'Honda', model: 'CR-V', trim: 'EX AWD',
    body: 'SUV', doors: 4, engine: '1.5L Turbo I4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [27, 32],
    ext: 'Modern Steel Metallic', hex: '#5b6068', int: 'Gray Cloth',
    mileage: 54730, price: 25900, cost: 22100, pack: 795, recon: 980, market: 26300,
    dis: 13, reconDays: 5, status: 'FRONT_LINE_READY', source: 'LEASE_RETURN',
    oneOwner: true, noAccidents: true,
    options: S('Honda Sensing', 'Power Moonroof', 'Heated Seats', 'Remote Start', 'Dual-Zone Climate'),
    callouts: S('Off-lease one owner', 'Honda Sensing'),
    description:
      'Off-lease CR-V EX with the moonroof, heated seats and the full Honda Sensing suite. Single owner, no accidents reported, and it came back clean enough to need almost nothing in recon.',
  },
  {
    lot: 'VAN', year: 2017, make: 'Toyota', model: 'Tacoma', trim: 'SR5 Double Cab 4x4',
    body: 'TRUCK', doors: 4, engine: '3.5L V6', cylinders: 6, transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD', fuel: 'GAS', mpg: [18, 22],
    ext: 'Silver Sky Metallic', hex: '#b8bdc4', int: 'Cement Gray Cloth',
    mileage: 108220, price: 27995, cost: 23800, pack: 795, recon: 1420, market: 28400,
    dis: 3, reconDays: null, status: 'PHOTOS_PENDING', source: 'STREET_PURCHASE',
    oneOwner: false, noAccidents: true,
    options: S('SR5 Package', 'Bed Liner', 'Tow Hitch', 'Backup Camera', 'Crawl Control'),
    callouts: S('Tacomas do not sit', 'Recon complete — photos today'),
    description:
      'Double Cab 4x4 SR5 with the 3.5L V6. Tacomas hold value better than anything else on this lot and this one is honest — no lift, no oversized wheels, no mystery wiring. Photos going up today.',
  },
  {
    lot: 'VAN', year: 2022, make: 'Hyundai', model: 'Tucson', trim: 'SEL AWD',
    body: 'SUV', doors: 4, engine: '2.5L I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [24, 29],
    ext: 'Amazon Gray', hex: '#4d5358', int: 'Black Cloth',
    mileage: 33150, price: 24750, cost: 21000, pack: 795, recon: 640, market: 25100,
    dis: 7, reconDays: 4, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: true, noAccidents: true,
    options: S('SmartSense Safety', 'Heated Seats', 'Wireless CarPlay', 'Dual-Zone Climate', 'Power Driver Seat'),
    callouts: S('Balance of factory warranty', 'Low miles'),
    description:
      'Low-mileage Tucson SEL still carrying the balance of Hyundai factory coverage. Wireless CarPlay, heated seats, and the SmartSense driver-assist package. Turned in recon in four days.',
  },
  {
    lot: 'VAN', year: 2016, make: 'Honda', model: 'Civic', trim: 'EX Sedan',
    body: 'SEDAN', doors: 4, engine: '2.0L I4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'FWD', fuel: 'GAS', mpg: [31, 40],
    ext: 'Aegean Blue Metallic', hex: '#22406f', int: 'Black Cloth',
    mileage: 112480, price: 14495, cost: 11600, pack: 795, recon: 1340, market: 14700,
    dis: 19, reconDays: 8, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: false, noAccidents: true,
    options: S('Sunroof', 'Backup Camera', 'Apple CarPlay', 'Alloy Wheels', 'Keyless Entry'),
    callouts: S('40 MPG highway', 'Great first car'),
    description:
      'Civic EX with the sunroof and CarPlay. Forty miles per gallon on the highway and a maintenance history that does not scare anybody. Ideal first car or commuter.',
  },
  {
    lot: 'VAN', year: 2019, make: 'Jeep', model: 'Grand Cherokee', trim: 'Laredo E 4x4',
    body: 'SUV', doors: 4, engine: '3.6L V6', cylinders: 6, transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD', fuel: 'GAS', mpg: [18, 25],
    ext: 'Granite Crystal Metallic', hex: '#484a4f', int: 'Black Cloth',
    mileage: 79610, price: 23995, cost: 20300, pack: 795, recon: 1860, market: 24200,
    dis: 22, reconDays: 9, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: false,
    options: S('Quadra-Trac 4x4', 'Uconnect 8.4', 'Backup Camera', 'Tow Package', 'Remote Start'),
    callouts: S('Tow package', 'New front brakes'),
    description:
      'Grand Cherokee Laredo E with Quadra-Trac and the factory tow package. Carfax shows a minor reported incident with no structural damage — we will show you the report before you ask.',
  },
  {
    lot: 'VAN', year: 2020, make: 'Subaru', model: 'Forester', trim: 'Premium AWD',
    body: 'SUV', doors: 4, engine: '2.5L H4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [26, 33],
    ext: 'Jasper Green Metallic', hex: '#31493c', int: 'Gray Cloth',
    mileage: 61340, price: 24995, cost: 21400, pack: 795, recon: 890, market: 25300,
    dis: 24, reconDays: 6, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: true, noAccidents: true,
    options: S('EyeSight', 'Panoramic Moonroof', 'Heated Seats', 'X-Mode', 'Power Liftgate'),
    callouts: S('One owner', 'Panoramic moonroof'),
    description:
      'One-owner Forester Premium with the panoramic moonroof and EyeSight. Symmetrical AWD, X-Mode, and enough ground clearance for every forest road within two hours of here.',
  },
  {
    lot: 'VAN', year: 2018, make: 'Chevrolet', model: 'Silverado 1500', trim: 'LT Double Cab 4x4',
    body: 'TRUCK', doors: 4, engine: '5.3L V8', cylinders: 8, transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD', fuel: 'GAS', mpg: [16, 22],
    ext: 'Summit White', hex: '#f2f4f7', int: 'Dark Ash Cloth',
    mileage: 104870, price: 26750, cost: 22900, pack: 795, recon: 1980, market: 26900,
    dis: 27, reconDays: 11, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('5.3L EcoTec3 V8', 'Trailer Package', 'Bedliner', 'Backup Camera', 'Bluetooth'),
    callouts: S('5.3L V8', 'Work-ready'),
    description:
      'Silverado LT Double Cab 4x4 with the 5.3L V8 and trailering package. Straight body, solid frame, and it has been used the way a truck is supposed to be used. Priced to move.',
  },
  {
    lot: 'VAN', year: 2021, make: 'Kia', model: 'Sorento', trim: 'LX AWD',
    body: 'SUV', doors: 4, engine: '2.5L I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [24, 29],
    ext: 'Gravity Gray', hex: '#3f444b', int: 'Black Cloth',
    mileage: 47220, price: 23450, cost: 19900, pack: 795, recon: 1120, market: 23800,
    dis: 29, reconDays: 7, status: 'FRONT_LINE_READY', source: 'LEASE_RETURN',
    oneOwner: true, noAccidents: true,
    options: S('Third Row Seating', 'Apple CarPlay', 'Blind Spot Monitor', 'Rear Camera', 'Roof Rails'),
    callouts: S('Third row', 'Balance of powertrain warranty'),
    description:
      'Three-row Sorento LX AWD with the balance of Kia powertrain coverage still on it. Fits the car seats, fits the garage, and returns high-20s on the highway.',
  },
  {
    lot: 'VAN', year: 2017, make: 'Mazda', model: 'CX-5', trim: 'Touring AWD',
    body: 'SUV', doors: 4, engine: '2.5L I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [23, 29],
    ext: 'Soul Red Crystal', hex: '#8e1d1d', int: 'Black Leatherette',
    mileage: 88960, price: 17995, salePrice: 17250, cost: 14700, pack: 795, recon: 1510, market: 18200,
    dis: 34, reconDays: 8, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: false, noAccidents: true,
    options: S('Blind Spot Monitor', 'Heated Seats', 'Power Liftgate', 'Backup Camera', 'Bose Audio'),
    callouts: S('Price reduced', 'Soul Red'),
    description:
      'CX-5 Touring AWD in Soul Red with the Bose system and heated seats. Drives tighter than anything else in the segment. Repriced this week.',
  },
  {
    lot: 'VAN', year: 2019, make: 'Nissan', model: 'Rogue', trim: 'SV AWD',
    body: 'SUV', doors: 4, engine: '2.5L I4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [25, 32],
    ext: 'Gun Metallic', hex: '#4b5057', int: 'Charcoal Cloth',
    mileage: 74510, price: 18450, cost: 15400, pack: 795, recon: 1220, market: 18300,
    dis: 38, reconDays: 6, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('ProPILOT Assist', 'Power Liftgate', 'Remote Start', 'Backup Camera', 'Blind Spot Warning'),
    callouts: S('ProPILOT Assist'),
    description:
      'Rogue SV AWD with ProPILOT Assist and the power liftgate. Comfortable highway car with a real all-wheel-drive system for the two weeks a year we need one.',
  },
  {
    lot: 'VAN', year: 2015, make: 'Toyota', model: 'Camry', trim: 'LE',
    body: 'SEDAN', doors: 4, engine: '2.5L I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'FWD', fuel: 'GAS', mpg: [24, 33],
    ext: 'Predawn Gray Mica', hex: '#7e838a', int: 'Ash Cloth',
    mileage: 129340, price: 11995, cost: 9200, pack: 795, recon: 1380, market: 12100,
    dis: 44, reconDays: 9, status: 'FRONT_LINE_READY', source: 'STREET_PURCHASE',
    oneOwner: false, noAccidents: true,
    options: S('Backup Camera', 'Bluetooth', 'Cruise Control', 'Power Seat'),
    callouts: S('Under $12,000', 'Runs and drives strong'),
    description:
      'Straight-shooting Camry LE. High miles, honest price, and the 2AR-FE four-cylinder that goes 250,000 miles if you change the oil. Everything works.',
  },
  {
    lot: 'VAN', year: 2016, make: 'Ram', model: '1500', trim: 'Big Horn Crew Cab 4x4',
    body: 'TRUCK', doors: 4, engine: '5.7L HEMI V8', cylinders: 8, transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD', fuel: 'GAS', mpg: [15, 21],
    ext: 'Bright White', hex: '#f4f6f8', int: 'Diesel Gray Cloth',
    mileage: 118720, price: 24995, salePrice: 23995, cost: 21600, pack: 795, recon: 2340, market: 24600,
    dis: 51, reconDays: 12, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('5.7L HEMI', 'Tow Package', 'Bedliner', 'Uconnect', 'Running Boards'),
    callouts: S('HEMI V8', 'Priced to move'),
    description:
      'Big Horn Crew Cab 4x4 with the 5.7 HEMI and tow package. It has been here a minute, so the price now reflects that more than it reflects the truck.',
  },
  {
    lot: 'VAN', year: 2018, make: 'Hyundai', model: 'Elantra', trim: 'SEL',
    body: 'SEDAN', doors: 4, engine: '2.0L I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'FWD', fuel: 'GAS', mpg: [28, 37],
    ext: 'Symphony Silver', hex: '#b4b9c0', int: 'Gray Cloth',
    mileage: 96180, price: 12995, cost: 10300, pack: 795, recon: 1180, market: 13100,
    dis: 57, reconDays: 7, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('Apple CarPlay', 'Backup Camera', 'Blind Spot Monitor', 'Alloy Wheels'),
    callouts: S('37 MPG highway', 'Motivated seller'),
    description:
      'Elantra SEL with CarPlay and blind-spot monitoring. Cheap to run, cheap to insure, and it has been on the lot long enough that we are motivated.',
  },
  {
    lot: 'VAN', year: 2014, make: 'Chevrolet', model: 'Equinox', trim: 'LT AWD',
    body: 'SUV', doors: 4, engine: '2.4L I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [20, 29],
    ext: 'Black Granite Metallic', hex: '#212429', int: 'Jet Black Cloth',
    mileage: 141650, price: 9495, cost: 8600, pack: 795, recon: 1890, market: 9300,
    dis: 88, reconDays: 21, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: false, noAccidents: false,
    options: S('AWD', 'Backup Camera', 'Bluetooth', 'Roof Rails'),
    callouts: S('AWD', 'Make us an offer'),
    description:
      'Equinox LT AWD. High miles and it needed more in recon than we planned for. Priced to be gone this week — bring a reasonable offer.',
  },

  /* ------------------------------------------------ Battle Ground rooftop */
  {
    lot: 'BG', year: 2020, make: 'Toyota', model: '4Runner', trim: 'SR5 4x4',
    body: 'SUV', doors: 4, engine: '4.0L V6', cylinders: 6, transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD', fuel: 'GAS', mpg: [16, 19],
    ext: 'Nautical Blue Pearl', hex: '#23405e', int: 'Black SofTex',
    mileage: 72140, price: 36995, cost: 32400, pack: 695, recon: 1340, market: 37500,
    dis: 5, reconDays: 4, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: true, noAccidents: true,
    options: S('Part-Time 4WD', 'Third Row Delete', 'Roof Rack', 'Tow Package', 'Backup Camera'),
    callouts: S('One owner', '4Runners do not depreciate'),
    description:
      'One-owner 4Runner SR5 4x4. Body-on-frame, locking transfer case, and a resale curve that barely bends. If you have been waiting for one, this is the one.',
  },
  {
    lot: 'BG', year: 2019, make: 'Honda', model: 'Accord', trim: 'Sport 1.5T',
    body: 'SEDAN', doors: 4, engine: '1.5L Turbo I4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'FWD', fuel: 'GAS', mpg: [29, 35],
    ext: 'Platinum White Pearl', hex: '#f0f2f5', int: 'Black Cloth',
    mileage: 66830, price: 22450, cost: 18900, pack: 695, recon: 1060, market: 22800,
    dis: 12, reconDays: 5, status: 'PENDING_SALE', source: 'LEASE_RETURN',
    oneOwner: true, noAccidents: true,
    options: S('Honda Sensing', '19-inch Wheels', 'Dual-Zone Climate', 'Remote Start', 'Apple CarPlay'),
    callouts: S('Deposit taken', 'One owner'),
    description:
      'Accord Sport 1.5T with the 19s and Honda Sensing. Deposit is down — contact us to get on the backup list.',
  },
  {
    lot: 'BG', year: 2021, make: 'Subaru', model: 'Crosstrek', trim: 'Premium AWD',
    body: 'HATCHBACK', doors: 4, engine: '2.0L H4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [28, 33],
    ext: 'Cool Gray Khaki', hex: '#8b8b7a', int: 'Black Cloth',
    mileage: 44610, price: 24995, cost: 21300, pack: 695, recon: 780, market: 25200,
    dis: 2, reconDays: null, status: 'IN_RECON', source: 'AUCTION',
    oneOwner: true, noAccidents: true,
    options: S('EyeSight', 'X-Mode', 'Heated Seats', 'Roof Rails', 'Apple CarPlay'),
    callouts: S('Cool Gray Khaki', 'Just arrived'),
    description:
      'Crosstrek Premium in the Cool Gray Khaki everyone asks for. Just landed and in recon now. Call if you want first look when it hits the front line.',
  },
  {
    lot: 'BG', year: 2017, make: 'GMC', model: 'Sierra 1500', trim: 'SLE Crew Cab 4x4',
    body: 'TRUCK', doors: 4, engine: '5.3L V8', cylinders: 8, transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD', fuel: 'GAS', mpg: [16, 22],
    ext: 'Onyx Black', hex: '#17191d', int: 'Jet Black Cloth',
    mileage: 111290, price: 27450, cost: 23700, pack: 695, recon: 2010, market: 27600,
    dis: 18, reconDays: 10, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('5.3L V8', 'Trailering Package', 'Bedliner', 'Backup Camera', 'Chrome Package'),
    callouts: S('Crew cab 4x4', 'Tow package'),
    description:
      'Sierra SLE Crew Cab 4x4 with the 5.3 and factory trailering. Chrome package, clean interior, and no bed damage worth mentioning.',
  },
  {
    lot: 'BG', year: 2018, make: 'Toyota', model: 'Corolla', trim: 'LE',
    body: 'SEDAN', doors: 4, engine: '1.8L I4', cylinders: 4, transmission: 'CVT',
    drivetrain: 'FWD', fuel: 'GAS', mpg: [28, 36],
    ext: 'Classic Silver Metallic', hex: '#b9bec5', int: 'Ash Cloth',
    mileage: 87420, price: 15495, cost: 12600, pack: 695, recon: 1090, market: 15700,
    dis: 26, reconDays: 6, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: true, noAccidents: true,
    options: S('Toyota Safety Sense', 'Backup Camera', 'Bluetooth', 'Cruise Control'),
    callouts: S('One owner', 'Toyota Safety Sense'),
    description:
      'One-owner Corolla LE with Toyota Safety Sense standard. Nothing exciting ever happens to these, which is exactly the point.',
  },
  {
    lot: 'BG', year: 2016, make: 'Ford', model: 'Escape', trim: 'SE AWD',
    body: 'SUV', doors: 4, engine: '1.6L EcoBoost I4', cylinders: 4, transmission: 'AUTOMATIC',
    drivetrain: 'AWD', fuel: 'GAS', mpg: [21, 28],
    ext: 'Magnetic Metallic', hex: '#4c5158', int: 'Charcoal Black Cloth',
    mileage: 103880, price: 12995, cost: 10400, pack: 695, recon: 1460, market: 13000,
    dis: 41, reconDays: 8, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('AWD', 'SYNC', 'Backup Camera', 'Alloy Wheels', 'Keyless Entry'),
    callouts: S('AWD under $13k'),
    description:
      'Escape SE AWD under thirteen thousand. EcoBoost four, SYNC, and a clean interior. Good winter car for someone who does not want a payment.',
  },
  {
    lot: 'BG', year: 2019, make: 'Chrysler', model: 'Pacifica', trim: 'Touring L',
    body: 'VAN', doors: 4, engine: '3.6L V6', cylinders: 6, transmission: 'AUTOMATIC',
    drivetrain: 'FWD', fuel: 'GAS', mpg: [19, 28],
    ext: 'Billet Silver Metallic', hex: '#a8adb5', int: 'Black Leather',
    mileage: 81570, price: 19995, cost: 16800, pack: 695, recon: 1540, market: 20100,
    dis: 55, reconDays: 9, status: 'FRONT_LINE_READY', source: 'AUCTION',
    oneOwner: false, noAccidents: true,
    options: S('Stow n Go Seating', 'Leather', 'Power Sliding Doors', 'Rear Camera', 'Tri-Zone Climate'),
    callouts: S('Stow n Go', 'Leather'),
    description:
      'Pacifica Touring L with Stow n Go and leather. Power doors on both sides work as they should. The most useful vehicle on this lot and nobody wants to admit it.',
  },
  {
    lot: 'BG', year: 2013, make: 'Honda', model: 'Odyssey', trim: 'EX-L',
    body: 'VAN', doors: 4, engine: '3.5L V6', cylinders: 6, transmission: 'AUTOMATIC',
    drivetrain: 'FWD', fuel: 'GAS', mpg: [18, 27],
    ext: 'Alabaster Silver Metallic', hex: '#c4c8ce', int: 'Gray Leather',
    mileage: 154220, price: 10495, cost: 8900, pack: 695, recon: 1620, market: 10300,
    dis: 73, reconDays: 14, status: 'FRONT_LINE_READY', source: 'TRADE_IN',
    oneOwner: false, noAccidents: true,
    options: S('Leather', 'Power Sliding Doors', 'Sunroof', 'Rear Entertainment', 'Backup Camera'),
    callouts: S('Third row', 'Priced to move'),
    description:
      'Odyssey EX-L with leather, sunroof and rear entertainment. High miles and it has been here a while — the price says so.',
  },
];

/* -------------------------------------------------------------- channels */

export interface SeedChannel {
  key: string;
  name: string;
  shortName: string;
  kind: 'WEBSITE' | 'SOCIAL' | 'SEARCH' | 'MARKETPLACE' | 'CLASSIFIED';
  syncMode: 'PUSH_API' | 'FEED_PULL';
  cadenceMinutes: number;
  brandHex: string;
  initials: string;
  blurb: string;
  maxPhotos: number;
  sortOrder: number;
}

export const SEED_CHANNELS: SeedChannel[] = [
  {
    key: 'dealer_site', name: 'Dealer Website', shortName: 'Website', kind: 'WEBSITE',
    syncMode: 'PUSH_API', cadenceMinutes: 0, brandHex: '#0f766e', initials: 'WS',
    blurb: 'Your own site. Writes are immediate — the VDP is rendered from this record.',
    maxPhotos: 40, sortOrder: 1,
  },
  {
    key: 'meta_catalog', name: 'Meta Catalog (Facebook & Instagram Ads)', shortName: 'Meta Catalog',
    kind: 'SOCIAL', syncMode: 'PUSH_API', cadenceMinutes: 0, brandHex: '#1877f2', initials: 'MC',
    blurb: 'Automotive Inventory Ads catalog. Pushed over the Marketing API; typically live within a minute or two.',
    maxPhotos: 20, sortOrder: 2,
  },
  {
    key: 'google_vla', name: 'Google Vehicle Ads', shortName: 'Google VLA', kind: 'SEARCH',
    syncMode: 'FEED_PULL', cadenceMinutes: 240, brandHex: '#ea4335', initials: 'GV',
    blurb: 'Google fetches the vehicle feed on its own schedule. Changes land at the next fetch, not instantly.',
    maxPhotos: 20, sortOrder: 3,
  },
  {
    key: 'fb_marketplace', name: 'Facebook Marketplace', shortName: 'Marketplace',
    kind: 'MARKETPLACE', syncMode: 'FEED_PULL', cadenceMinutes: 60, brandHex: '#0866ff', initials: 'FM',
    blurb: 'Partner vehicle listings. Feed-based — Meta pulls hourly and re-indexes on its own clock.',
    maxPhotos: 20, sortOrder: 4,
  },
  {
    key: 'cargurus', name: 'CarGurus', shortName: 'CarGurus', kind: 'MARKETPLACE',
    syncMode: 'FEED_PULL', cadenceMinutes: 60, brandHex: '#0d5c63', initials: 'CG',
    blurb: 'Hourly feed pull. Price changes affect deal rating on their next index.',
    maxPhotos: 30, sortOrder: 5,
  },
  {
    key: 'cars_com', name: 'Cars.com', shortName: 'Cars.com', kind: 'MARKETPLACE',
    syncMode: 'FEED_PULL', cadenceMinutes: 240, brandHex: '#5c2d91', initials: 'CC',
    blurb: 'Feed pull every four hours. Rejects listings under their photo minimum.',
    maxPhotos: 30, sortOrder: 6,
  },
  {
    key: 'autotrader', name: 'Autotrader', shortName: 'Autotrader', kind: 'MARKETPLACE',
    syncMode: 'FEED_PULL', cadenceMinutes: 240, brandHex: '#e5202e', initials: 'AT',
    blurb: 'Feed pull every four hours via the Cox inventory pipeline.',
    maxPhotos: 30, sortOrder: 7,
  },
  {
    key: 'craigslist', name: 'Craigslist', shortName: 'Craigslist', kind: 'CLASSIFIED',
    syncMode: 'PUSH_API', cadenceMinutes: 2880, brandHex: '#5b2d8e', initials: 'CL',
    blurb: 'Posts on your behalf. Craigslist rate-limits renewals, so a repost is capped at once every 48 hours.',
    maxPhotos: 24, sortOrder: 8,
  },
  {
    key: 'offerup', name: 'OfferUp', shortName: 'OfferUp', kind: 'MARKETPLACE',
    syncMode: 'PUSH_API', cadenceMinutes: 0, brandHex: '#4bb54b', initials: 'OU',
    blurb: 'Direct posting. Edits push immediately.',
    maxPhotos: 12, sortOrder: 9,
  },
];

/** Pool used to generate trailing-180-day sales history for turn / days supply. */
export const SOLD_POOL: Array<[number, string, string, string, number, number]> = [
  // year, make, model, trim, sold price, cost
  [2018, 'Toyota', 'RAV4', 'LE AWD', 20995, 17600],
  [2017, 'Honda', 'CR-V', 'EX AWD', 19495, 16300],
  [2019, 'Subaru', 'Outback', '2.5i Limited', 24995, 21200],
  [2016, 'Ford', 'F-150', 'XLT 4x4', 24450, 20900],
  [2015, 'Toyota', 'Camry', 'SE', 12995, 10200],
  [2018, 'Nissan', 'Rogue', 'SV AWD', 16995, 13900],
  [2017, 'Chevrolet', 'Silverado 1500', 'LT 4x4', 25995, 22400],
  [2019, 'Hyundai', 'Elantra', 'SEL', 13995, 11100],
  [2020, 'Subaru', 'Forester', 'Base AWD', 22995, 19400],
  [2016, 'Honda', 'Civic', 'LX', 13495, 10700],
  [2018, 'Jeep', 'Grand Cherokee', 'Laredo 4x4', 22495, 19100],
  [2017, 'Mazda', 'CX-5', 'Sport AWD', 15995, 12900],
  [2019, 'Toyota', 'Tacoma', 'SR 4x4', 26995, 23200],
  [2014, 'Chevrolet', 'Equinox', 'LS', 8995, 7100],
  [2021, 'Kia', 'Sorento', 'S AWD', 24495, 21000],
  [2018, 'Ram', '1500', 'Express 4x4', 23995, 20600],
  [2013, 'Honda', 'Odyssey', 'EX', 9495, 7400],
  [2019, 'Honda', 'Accord', 'LX', 20995, 17700],
  [2017, 'Subaru', 'Crosstrek', 'Premium', 17995, 14900],
  [2015, 'Toyota', 'Corolla', 'LE', 11995, 9300],
  [2020, 'Hyundai', 'Tucson', 'SE AWD', 21495, 18200],
  [2016, 'GMC', 'Sierra 1500', 'SLE 4x4', 24995, 21500],
  [2018, 'Ford', 'Escape', 'SE AWD', 14995, 12100],
  [2019, 'Chrysler', 'Pacifica', 'Touring', 18995, 15800],
];
