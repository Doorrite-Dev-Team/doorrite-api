# Rider Earnings API Documentation

> For Frontend Team - Version 1.0

---

## Overview

This document outlines the Rider Earnings and Payout system API endpoints. The system calculates earnings automatically when deliveries are completed, tracks wallet balance, processes weekly payouts, and supports manual withdrawal requests.

---

## Base URL

```
/api/v1/riders
```

---

## Authentication

All rider endpoints require authentication. Include the rider's access token in the Authorization header:

```
Authorization: Bearer <access_token>
```

---

## Endpoints

### 1. Get Earnings Summary

> Get rider's earnings overview (today, this week, this month)

**Endpoint:** `GET /api/v1/riders/earnings/summary`

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

---

### 2. Get Transaction History

> Get list of all wallet transactions (earnings, payouts, bonuses)

**Endpoint:** `GET /api/v1/riders/earnings/transactions`

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |
| `type` | string | - | Filter by type (EARNING, PAYOUT, BONUS, ADJUSTMENT) |

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
          "baseFee": 200,
          "distanceFee": 750,
          "peakBonus": 712.5,
          "platformFee": 166.25,
          "riderEarnings": 1496.25
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

---

### 3. Get Earnings History

> Get detailed earnings records with breakdown

**Endpoint:** `GET /api/v1/riders/earnings/history`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | string | Start date (YYYY-MM-DD) |
| `to` | string | End date (YYYY-MM-DD) |

**Response:**
```json
{
  "ok": true,
  "data": {
    "records": [
      {
        "id": "er_123",
        "orderId": "order_456",
        "baseFee": 200,
        "distanceFee": 750,
        "distanceKm": 5,
        "peakMultiplier": 1.5,
        "subtotal": 1425,
        "platformFee": 142.5,
        "riderEarnings": 1282.5,
        "waitTimeMinutes": 0,
        "waitTimeFee": 0,
        "completedAt": "2024-01-15T19:30:00Z"
      }
    ],
    "summary": {
      "totalEarnings": 45000.0,
      "totalDeliveries": 85,
      "avgPerDelivery": 529.41,
      "peakEarnings": 15000.0
    }
  }
}
```

---

### 4. Get Performance Metrics

> Get rider's delivery performance statistics

**Endpoint:** `GET /api/v1/riders/earnings/metrics`

**Response:**
```json
{
  "ok": true,
  "data": {
    "totalDeliveries": 250,
    "avgDeliveryTimeMinutes": 22,
    "rating": 4.8,
    "totalRatings": 198,
    "thisWeek": {
      "deliveries": 28,
      "earnings": 15000.0,
      "avgTimeMinutes": 20
    }
  }
}
```

---

### 5. Request Withdrawal

> Request a payout from wallet balance

**Endpoint:** `POST /api/v1/riders/earnings/withdraw`

**Request Body:**
```json
{
  "amount": 5000,
  "bankName": "First Bank",
  "accountNumber": "1234567890",
  "accountName": "John Doe"
}
```

**Rules:**
- Minimum withdrawal: ₦2,000
- **Friday (12:00 AM - 11:59 AM):** Free withdrawal
- **Any other day:** ₦100 fee applies
- Balance must be sufficient

**Response:**
```json
{
  "ok": true,
  "message": "Withdrawal request submitted",
  "data": {
    "withdrawalId": "wd_789",
    "amount": 5000,
    "status": "PENDING",
    "estimatedProcessing": "This Friday",
    "feeApplied": 0
  }
}
```

**Error Responses:**
```json
{
  "ok": false,
  "message": "Insufficient balance"
}

{
  "ok": false,
  "message": "Minimum withdrawal is ₦2000"
}

{
  "ok": false,
  "message": "Insufficient balance. Total deduction would be ₦5100 (includes ₦100 fee)"
}
```

---

### 6. Get Withdrawal History

> Get list of past withdrawal requests

**Endpoint:** `GET /api/v1/riders/earnings/withdrawals`

**Query Parameters:**
| Parameter | Type | Default |
|-----------|------|---------|
| `page` | number | 1 |
| `limit` | number | 10 |

**Response:**
```json
{
  "ok": true,
  "data": {
    "withdrawals": [
      {
        "id": "wd_789",
        "amount": 5000.00,
        "requestType": "WEEKLY",
        "status": "APPROVED",
        "bankName": "First Bank",
        "accountNumber": "****5678",
        "accountName": "John Doe",
        "scheduledDate": "2024-01-15T10:00:00Z",
        "processedAt": null,
        "adminNotes": null,
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

**Payout Statuses:**
- `PENDING` - Awaiting admin approval
- `APPROVED` - Approved, awaiting payment
- `PROCESSING` - Payment in progress
- `COMPLETED` - Successfully paid
- `REJECTED` - Rejected by admin
- `FAILED` - Payment failed

---

### 7. Get Payout Info

> Get payout schedule and wallet information

**Endpoint:** `GET /api/v1/riders/payout-info`

**Response:**
```json
{
  "ok": true,
  "data": {
    "nextPayoutDate": "2024-01-19",
    "nextPayoutAmount": 0,
    "minimumBalance": 2000,
    "paymentMethod": null,
    "autoPayoutEnabled": false,
    "autoPayoutDay": "friday",
    "walletBalance": 15000.0,
    "isFriday": true
  }
}
```

---

## Earnings Calculation

### Fee Structure

| Component | Value | Description |
|-----------|-------|-------------|
| **Base Fee** | ₦200 | Flat rate per delivery |
| **Distance Rate** | ₦150/km | Per kilometer |
| **Platform Fee** | 10% | Commission deducted |
| **Peak Hours** | 1.5x | 12-3 PM & 6-9 PM |

### Peak Hours
- **Lunch:** 12:00 PM - 3:00 PM
- **Dinner:** 6:00 PM - 9:00 PM

### Business Rules
- **Short Trip Minimum:** ₦800 (minimum earnings per delivery)
- **Wait Fee:** ₦20/minute after 15 minutes (capped at ₦500)
- **Referral Bonus:** ₦1,000 for each referred rider

### Example Calculation

**Scenario:** 5km delivery at 7:30 PM (Peak Hour)

```
Base Fee:        ₦200
Distance Fee:    ₦750    (5km × ₦150)
                 ─────────────
Subtotal:        ₦950
Peak (1.5x):     ₦1,425
Platform Fee:    -₦142.5  (10%)
                 ─────────────
Rider Earnings:  ₦1,282.50
```

---

## Admin Endpoints (For Dashboard)

### Get All Payouts
```
GET /api/v1/admin/payouts?status=PENDING&page=1&limit=20
```

### Approve Payout
```
PATCH /api/v1/admin/payouts/:id/approve
Body: { "notes": "Approved for payment" }
```

### Reject Payout
```
PATCH /api/v1/admin/payouts/:id/reject
Body: { "notes": "Invalid account details" }
```

### Complete Payout
```
PATCH /api/v1/admin/payouts/:id/complete
Body: { "reference": "TRF123456", "notes": "Payment sent" }
```

### Get Rider Earnings
```
GET /api/v1/admin/riders/:riderId/earnings?from=2024-01-01&to=2024-01-31
```

### Adjust Rider Balance
```
PATCH /api/v1/admin/riders/:riderId/adjust
Body: { "amount": 5000, "type": "ADD", "description": "Bonus payment" }
```

---

## Socket Events

The following events are emitted to the rider:

| Event | Payload | Description |
|-------|---------|-------------|
| `earnings:updated` | `{ total, change, transaction }` | New earnings added |
| `payout:status` | `{ payoutId, status }` | Payout status changed |
| `payout:processed` | `{ amount, reference }` | Payout completed |

---

## Error Codes

| Code | Message |
|------|---------|
| `INSUFFICIENT_BALANCE` | Requested amount exceeds available balance |
| `BELOW_MINIMUM_PAYOUT` | Amount below minimum withdrawal threshold |
| `PAYOUT_IN_PROGRESS` | Another payout is already being processed |
| `INVALID_PAYMENT_METHOD` | Payment method not configured |

---

## Notes for Frontend

1. **Friday Check:** Show "Free Withdrawal" badge on Fridays
2. **Balance Display:** Always show available balance (exclude pending payouts)
3. **Withdrawal Fee:** On non-Fridays, display fee warning before submission
4. **Transaction Types:** Filter by type for better UX (EARNING, PAYOUT, BONUS)
5. **Payout Status:** Show appropriate status badges with colors:
   - Green: COMPLETED
   - Blue: APPROVED, PROCESSING
   - Yellow: PENDING
   - Red: REJECTED, FAILED
