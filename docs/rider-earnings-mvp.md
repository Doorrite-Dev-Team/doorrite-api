# Rider Earnings MVP - Feature Specification

> Document for Backend Development Team
> Version: 1.0 | Status: MVP

---

## Overview

This document outlines the MVP earnings and payout system for riders. The system calculates earnings automatically when deliveries are completed, tracks wallet balance, processes weekly payouts, and supports manual withdrawal requests.

---

## 1. Earnings Calculation

### 1.1 Base Fee Structure

```typescript
interface EarningsBreakdown {
  baseFee: number; // Flat rate per delivery
  distanceFee: number; // Per-kilometer rate
  peakBonus: number; // Peak hour multiplier bonus
  subtotal: number; // Before platform fee
  platformFee: number; // 15% commission deducted
  riderEarnings: number; // Final amount to rider
}
```

### 1.2 Fee Configuration

| Component         | Value  | Description                       |
| ----------------- | ------ | --------------------------------- |
| **Base Fee**      | ₦250   | Flat rate per delivery            |
| **Distance Rate** | ₦50/km | Calculated from pickup to dropoff |
| **Platform Fee**  | 15%    | Commission deducted from subtotal |

### 1.3 Peak Hour Multiplier

| Time Slot          | Multiplier | Days                |
| ------------------ | ---------- | ------------------- |
| 12:00 PM - 2:00 PM | 1.5x       | Weekdays & Weekends |
| 6:00 PM - 9:00 PM  | 1.5x       | Weekdays & Weekends |

### 1.4 Example Calculation

```
Delivery: 5km distance, completed at 7:30 PM (peak hour)

Base Fee:          ₦250.00
Distance Fee:      ₦250.00  (5km × ₦50)
Peak Bonus:        ₦750.00  (₦1,000 × 0.75 bonus)
─────────────────────────────
Subtotal:          ₦1,250.00
Platform Fee:      -₦187.50 (15% of ₦1,250)
─────────────────────────────
Rider Earnings:    ₦1,062.50
```

---

## 2. Database Schema

### 2.1 Wallet Model (Extend Existing)

```prisma
model Wallet {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  balance         Float    @default(0)        // Withdrawable balance
  pendingBalance  Float    @default(0)        // Pending clearance
  totalEarned     Float    @default(0)        // All-time earnings
  totalWithdrawn  Float    @default(0)        // All-time withdrawals
  lastUpdated     DateTime @updatedAt
  createdAt       DateTime @default(now())

  riderId  String  @unique @db.ObjectId
  rider    Rider   @relation(fields: [riderId], references: [id])

  transactions Transaction[]
  payoutSchedules PayoutSchedule[]

  @@index([riderId])
}
```

### 2.2 Transaction Model

```prisma
model Transaction {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  type        TransactionType  // EARNING, PAYOUT, BONUS, ADJUSTMENT
  amount      Float              // Positive = credit, Negative = debit
  description String
  reference   String?           // External reference (e.g., payout ID)

  // For earnings tracking
  orderId     String?  @db.ObjectId
  breakdown    Json?             // Full earnings breakdown object

  // Status
  status      TransactionStatus @default(COMPLETED)

  createdAt   DateTime @default(now())

  walletId    String   @db.ObjectId
  wallet      Wallet   @relation(fields: [walletId], references: [id])

  @@index([walletId, createdAt])
  @@index([orderId])
}

enum TransactionType {
  EARNING      // From completed delivery
  PAYOUT       // Withdrawal
  BONUS        // Peak hour, referral, etc.
  ADJUSTMENT   // Manual admin adjustment
}

enum TransactionStatus {
  PENDING
  COMPLETED
  CANCELLED
  FAILED
}
```

### 2.3 Payout Schedule Model

```prisma
model PayoutSchedule {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  amount        Float
  status        PayoutStatus @default(PENDING)

  // Processing dates
  scheduledDate DateTime
  processedAt   DateTime?

  // Payout method
  paymentMethod String?          // "bank_transfer", "paypal"
  paymentDetails Json?           // { bank: "...", account: "****1234" }

  // Admin approval
  approvedBy    String? @db.ObjectId
  approvedAt    DateTime?
  notes         String?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  walletId      String   @db.ObjectId
  wallet        Wallet   @relation(fields: [walletId], references: [id])

  transactionId String? @db.ObjectId
  transaction   Transaction? @relation(fields: [transactionId], references: [id])

  @@index([walletId, status])
}

enum PayoutStatus {
  PENDING      // Awaiting processing
  APPROVED     // Admin approved
  PROCESSING   // Being processed
  COMPLETED    // Successfully paid out
  REJECTED     // Admin rejected
  FAILED       // Payment failed
}
```

### 2.4 Earnings Breakdown Model (Per Order)

```prisma
model EarningsRecord {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId

  // Rider info
  riderId        String   @db.ObjectId

  // Order reference
  orderId        String   @unique @db.ObjectId
  order          Order    @relation(fields: [orderId], references: [id])

  // Earnings breakdown
  breakdown      Json              // See 1.1 structure
  baseFee        Float
  distanceFee    Float
  distanceKm     Float             // Distance in kilometers
  peakMultiplier Float             // 1.0 or 1.5
  peakBonus      Float

  // Fees
  subtotal       Float
  platformFee    Float             // 15% of subtotal
  riderEarnings Float             // Final amount

  // Timestamps
  completedAt    DateTime

  createdAt      DateTime @default(now())

  @@index([riderId, completedAt])
}
```

### 2.5 Order Model (Add Fields)

```prisma
model Order {
  // ... existing fields ...

  // Add these fields
  earningsRecord   EarningsRecord?

  // Delivery confirmation
  vendorCode      String?          // 6-digit code for vendor
  customerCode    String?          // 6-digit code for customer
  deliveredAt     DateTime?
  deliveryProof   String?          // Photo URL or signature
}
```

---

## 3. API Endpoints

### 3.1 Earnings Summary

```
GET /api/v1/riders/earnings/summary
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "today": 2500.0,
    "todayDeliveries": 5,
    "thisWeek": 15000.0,
    "thisWeekDeliveries": 28,
    "thisMonth": 45000.0,
    "thisMonthDeliveries": 85,
    "totalEarned": 125000.0,
    "pendingPayout": 15000.0,
    "availableBalance": 15000.0,
    "walletBalance": 15000.0
  }
}
```

### 3.2 Transaction History

```
GET /api/v1/riders/earnings/transactions?page=1&limit=20&type=EARNING
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "transactions": [
      {
        "id": "txn_123",
        "type": "EARNING",
        "amount": 1062.5,
        "description": "Delivery to Victoria Island",
        "orderId": "order_456",
        "breakdown": {
          "baseFee": 250,
          "distanceFee": 250,
          "peakBonus": 750,
          "platformFee": 187.5,
          "riderEarnings": 1062.5
        },
        "status": "COMPLETED",
        "createdAt": "2024-01-15T19:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 156,
      "totalPages": 8
    }
  }
}
```

### 3.3 Earnings History (Weekly Breakdown)

```
GET /api/v1/riders/earnings/history?from=2024-01-01&to=2024-01-31
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "weeks": [
      {
        "weekStart": "2024-01-08",
        "weekEnd": "2024-01-14",
        "totalEarnings": 18000.0,
        "totalDeliveries": 35,
        "avgPerDelivery": 514.29,
        "peakEarnings": 6000.0
      }
    ],
    "summary": {
      "totalEarnings": 45000.0,
      "totalDeliveries": 85,
      "avgPerDelivery": 529.41
    }
  }
}
```

### 3.4 Performance Metrics

```
GET /api/v1/riders/earnings/metrics
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "totalDeliveries": 250,
    "avgDeliveryTimeMinutes": 22,
    "rating": 4.8,
    "totalRatings": 198,
    "acceptanceRate": 85,
    "onTimeRate": 95,
    "thisWeek": {
      "deliveries": 28,
      "earnings": 15000.0,
      "avgTimeMinutes": 20
    }
  }
}
```

### 3.5 Payout Information

```
GET /api/v1/riders/payout-info
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "nextPayoutDate": "2024-01-19", // Friday
    "nextPayoutAmount": 15000.0,
    "minimumBalance": 1000.0,
    "paymentMethod": {
      "type": "bank_transfer",
      "bankName": "First Bank",
      "accountNumber": "****5678",
      "accountName": "John Doe"
    },
    "autoPayoutEnabled": true,
    "autoPayoutDay": "friday"
  }
}
```

### 3.6 Request Withdrawal

```
POST /api/v1/riders/earnings/withdraw
```

**Request:**

```json
{
  "amount": 5000.0,
  "paymentMethod": "bank_transfer"
}
```

**Response:**

```json
{
  "ok": true,
  "message": "Withdrawal request submitted",
  "data": {
    "withdrawalId": "wd_789",
    "amount": 5000.0,
    "status": "PENDING",
    "estimatedProcessing": "24-48 hours"
  }
}
```

### 3.7 Withdrawal History

```
GET /api/v1/riders/earnings/withdrawals?page=1&limit=10
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "withdrawals": [
      {
        "id": "wd_789",
        "amount": 5000.00,
        "status": "APPROVED",
        "paymentMethod": "bank_transfer",
        "requestedAt": "2024-01-15T10:00:00Z",
        "processedAt": "2024-01-16T14:30:00Z"
      }
    ],
    "pagination": {...}
  }
}
```

---

## 4. Business Logic

### 4.1 Calculate Earnings on Delivery Completion

```typescript
// Triggered when: order.status === DELIVERED
async function calculateEarnings(orderId: string) {
  const order = await getOrder(orderId);

  // Calculate distance (using coordinates or Google Maps API)
  const distanceKm = calculateDistance(
    order.pickupLocation,
    order.dropoffLocation,
  );

  // Check peak hour
  const isPeakHour = checkPeakHour(new Date());
  const peakMultiplier = isPeakHour ? 1.5 : 1.0;

  // Calculate fees
  const baseFee = 250;
  const distanceFee = distanceKm * 50;
  const peakBonus = isPeakHour ? (baseFee + distanceFee) * 0.75 : 0;
  const subtotal = baseFee + distanceFee + peakBonus;
  const platformFee = subtotal * 0.15;
  const riderEarnings = subtotal - platformFee;

  // Create earnings record
  const earningsRecord = await EarningsRecord.create({
    riderId: order.riderId,
    orderId: order.id,
    breakdown: { baseFee, distanceFee, peakBonus, platformFee, riderEarnings },
    baseFee,
    distanceFee,
    distanceKm,
    peakMultiplier: peakMultiplier,
    peakBonus,
    subtotal,
    platformFee,
    riderEarnings,
    completedAt: new Date(),
  });

  // Update wallet balance
  await Wallet.update({
    where: { riderId: order.riderId },
    data: {
      balance: { increment: riderEarnings },
      totalEarned: { increment: riderEarnings },
    },
  });

  // Create transaction
  await Transaction.create({
    walletId: wallet.id,
    type: "EARNING",
    amount: riderEarnings,
    description: `Delivery to ${order.dropoffLocation.address}`,
    orderId: order.id,
    breakdown: earningsRecord.breakdown,
    status: "COMPLETED",
  });

  return earningsRecord;
}
```

### 4.2 Peak Hour Check

```typescript
function checkPeakHour(date: Date): boolean {
  const hours = date.getHours();
  const day = date.getDay();

  // Lunch peak: 12 PM - 2 PM
  if (hours >= 12 && hours < 14) return true;

  // Dinner peak: 6 PM - 9 PM
  if (hours >= 18 && hours < 21) return true;

  return false;
}
```

### 4.3 Weekly Auto-Payout (Cron Job)

```typescript
// Runs every Friday at 6 PM
async function processWeeklyPayouts() {
  const wallets = await Wallet.findMany({
    where: {
      balance: { gte: 1000 }, // Minimum balance
    },
  });

  for (const wallet of wallets) {
    // Check if rider has auto-payout enabled
    const rider = await getRider(wallet.riderId);
    if (!rider.autoPayoutEnabled) continue;

    // Create payout schedule
    await PayoutSchedule.create({
      walletId: wallet.id,
      amount: wallet.balance,
      status: "PENDING",
      scheduledDate: new Date(),
    });

    // Move to pending (hold during processing)
    await Wallet.update({
      where: { id: wallet.id },
      data: {
        balance: 0,
        pendingBalance: wallet.balance,
      },
    });
  }
}
```

---

## 5. Socket Events (Real-time Updates)

### 5.1 Events to Emit to Rider

| Event              | Payload                          | Trigger              |
| ------------------ | -------------------------------- | -------------------- |
| `earnings:updated` | `{ total, change, transaction }` | New earnings added   |
| `payout:status`    | `{ payoutId, status }`           | Payout status change |
| `payout:processed` | `{ amount, reference }`          | Payout completed     |

### 5.2 Example Socket Handler

```typescript
// In rider socket service
async emitEarningsUpdate(riderId: string, update: EarningsUpdate) {
  const socket = this.getRiderSocket(riderId);
  if (socket) {
    socket.emit('earnings:updated', update);
  }
}
```

---

## 6. Admin Features

### 6.1 Admin Endpoints

```
GET    /api/v1/admin/payouts              // List all pending payouts
PATCH  /api/v1/admin/payouts/:id/approve  // Approve payout
PATCH  /api/v1/admin/payouts/:id/reject   // Reject payout
POST   /api/v1/admin/riders/:id/adjust    // Manual balance adjustment
```

### 6.2 Admin Payout Approval Flow

```
1. Rider requests withdrawal → PayoutSchedule created (PENDING)
2. Admin reviews in dashboard
3. Admin approves → status = APPROVED → PROCESSING → COMPLETED
4. On COMPLETED:
   - Transaction updated
   - Rider notified via socket
   - Wallet.pendingBalance reduced
```

---

## 7. Configuration

### 7.1 Constants

```typescript
const EARNINGS_CONFIG = {
  BASE_FEE: 250, // Naira
  PER_KM_RATE: 50, // Naira per km
  PLATFORM_FEE_PERCENT: 15, // 15%
  MIN_PAYOUT: 1000, // Minimum balance to trigger payout
  PAYOUT_SCHEDULE: "friday", // Weekly auto-payout day
  PEAK_HOURS: [
    { start: 12, end: 14 }, // Lunch
    { start: 18, end: 21 }, // Dinner
  ],
  PEAK_MULTIPLIER: 1.5,
};
```

### 7.2 Environment Variables

```bash
# Earnings Configuration
EARNINGS_BASE_FEE=250
EARNINGS_PER_KM_RATE=50
EARNINGS_PLATFORM_FEE_PERCENT=15
EARNINGS_MIN_PAYOUT=1000

# Distance Calculation (optional - use external API)
DISTANCE_API_KEY=
```

---

## 8. Error Handling

### 8.1 Error Codes

| Code                     | Message                                    | HTTP Status |
| ------------------------ | ------------------------------------------ | ----------- |
| `INSUFFICIENT_BALANCE`   | Requested amount exceeds available balance | 400         |
| `BELOW_MINIMUM_PAYOUT`   | Amount below minimum payout threshold      | 400         |
| `PAYOUT_IN_PROGRESS`     | Another payout is already being processed  | 409         |
| `INVALID_PAYMENT_METHOD` | Payment method not configured              | 400         |

---

## 9. Testing Scenarios

### 9.1 Unit Tests

- [ ] Earnings calculation (base + distance + peak)
- [ ] Platform fee calculation (15%)
- [ ] Peak hour detection
- [ ] Minimum payout validation
- [ ] Wallet balance updates

### 9.2 Integration Tests

- [ ] Complete delivery → earnings added to wallet
- [ ] Withdrawal request → balance deducted
- [ ] Weekly payout → all eligible riders processed
- [ ] Socket notification sent on earnings update

---

## 10. Acceptance Criteria

- [ ] Rider sees accurate earnings on each completed delivery
- [ ] Wallet balance updates in real-time
- [ ] Transaction history shows all earnings with breakdown
- [ ] Weekly payouts process on Fridays for balances ≥ ₦1,000
- [ ] Withdrawal requests can be submitted and tracked
- [ ] Admin can approve/reject withdrawal requests
- [ ] Socket notifications for earnings updates

---

## Questions / Clarifications Needed

1. **Distance Calculation**: Use straight-line or actual route distance?
2. **Peak Hour**: Apply to order completion time or pickup time?
3. **Failed Deliveries**: Any partial earnings for failed attempts?
4. **Referral Bonus**: When is it credited? On referred rider's first delivery?

---

_Document Created: 2024-01-15_
_Last Updated: 2024-01-15_
_Author: Rider UI Team_
