# Heliora API Reference

> **Base URL:** `{{NEXT_PUBLIC_API_URL}}` (configured in `.env.local`)
>
> **Network:** Stellar Testnet (default) or Mainnet

---

## Table of Contents

1. [Authentication](#authentication)
2. [Medical Records](#medical-records)
3. [Doctors & Slots](#doctors--slots)
4. [Appointments](#appointments)
5. [Hospital](#hospital)
6. [Users](#users)

---

## Authentication

All endpoints require a Stellar wallet public key passed as a query parameter or request body. Role-based access is enforced server-side.

| Method        | Requirement                              |
| ------------- | ---------------------------------------- |
| Public        | Landing pages, documentation             |
| Authenticated | Any connected wallet                     |
| Role-specific | `PATIENT`, `DOCTOR`, `HOSPITAL`, `ADMIN` |

---

## Medical Records

### List Records

```
GET /records
```

**Query Parameters:**

| Param            | Type     | Required | Description                       |
| ---------------- | -------- | -------- | --------------------------------- |
| `patientAddress` | `string` | Yes      | Stellar public key of the patient |
| `cursor`         | `string` | No       | Pagination cursor                 |
| `limit`          | `number` | No       | Page size (default: 10)           |

**Response:**

```json
{
  "data": [
    {
      "id": "HS-001337",
      "date": "2025-06-03T00:00:00Z",
      "doctorName": "Dr. Sarah Smith",
      "diagnosis": "Blood Test Results",
      "prescription": "Amoxicillin 500mg",
      "notes": "Follow-up in 2 weeks",
      "patientAddress": "GAKP...X7QM"
    }
  ],
  "nextCursor": "abc123",
  "total": 24
}

### Create Record

```

POST /records

````

**Request Body:**
```json
{
  "patientAddress": "GAKP...X7QM",
  "diagnosis": "Seasonal allergies",
  "prescription": "Cetirizine 10mg",
  "notes": "Patient reported mild symptoms"
}
````

**Response:** `201 Created`

```json
{
  "id": "HS-001401",
  "date": "2025-06-29T00:00:00Z",
  "doctorName": "Dr. Sarah Smith",
  "diagnosis": "Seasonal allergies",
  "prescription": "Cetirizine 10mg",
  "notes": "Patient reported mild symptoms",
  "patientAddress": "GAKP...X7QM"
}
```

### Share Record

```
POST /records/:id/share
```

**Request Body:**

```json
{
  "providerAddress": "GCMR...4BNP"
}
```

**Response:**

```json
{
  "token": "sh-abc123def456",
  "expiresAt": "2025-07-29T00:00:00Z",
  "providerAddress": "GCMR...4BNP"
}
```

### Upload Encrypted Record

```
POST /records/encrypted
```

**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field            | Type     | Required | Description                                        |
| ---------------- | -------- | -------- | -------------------------------------------------- |
| `patientAddress` | `string` | Yes      | Patient's Stellar public key                       |
| `fileName`       | `string` | Yes      | Original file name                                 |
| `fileType`       | `string` | Yes      | MIME type (application/pdf, image/jpeg, image/png) |
| `contentHash`    | `string` | Yes      | SHA-256 hash of encrypted content                  |
| `encryptedFile`  | `file`   | Yes      | AES-256-GCM encrypted file blob                    |
| `iv`             | `file`   | Yes      | Initialization vector (12 bytes)                   |
| `exportedKey`    | `file`   | Yes      | AES key exported in raw format                     |

**Response:** `201 Created`

```json
{
  "id": "enc-789abc",
  "patientAddress": "GAKP...X7QM",
  "fileName": "lab-results.pdf",
  "fileType": "application/pdf",
  "contentHash": "a1b2c3d4...",
  "encryptedMetadataPointer": "ipfs://Qm...",
  "uploadedAt": "2025-06-29T12:00:00Z",
  "txHash": "abc...def"
}

---

## Doctors & Slots

### List Doctors

```

GET /doctors

````

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `specialty` | `string` | No | Filter by specialty |

**Response:**
```json
[
  {
    "id": "doc-001",
    "name": "Dr. Sarah Smith",
    "specialty": "General Practitioner",
    "address": "GCMR...4BNP"
  }
]
````

### Get Doctor Patients (Paginated)

```
GET /doctors/patients
```

**Query Parameters:**

| Param           | Type     | Required | Description                 |
| --------------- | -------- | -------- | --------------------------- |
| `doctorAddress` | `string` | Yes      | Doctor's Stellar public key |
| `cursor`        | `string` | No       | Pagination cursor           |

---

## Appointments

### List Appointments

```
GET /appointments
```

**Query Parameters:**

| Param     | Type     | Required | Description           |
| --------- | -------- | -------- | --------------------- |
| `address` | `string` | Yes      | Stellar public key    |
| `role`    | `string` | Yes      | `patient` or `doctor` |

**Response:**

```json
[
  {
    "id": "apt-001",
    "doctorId": "doc-001",
    "doctorName": "Dr. Sarah Smith",
    "patientAddress": "GAKP...X7QM",
    "patientName": "John Doe",
    "datetime": "2025-07-01T09:00:00Z",
    "type": "in-person",
    "notes": "Follow-up on blood work",
    "status": "confirmed",
    "fee": 10,
    "txHash": "abc...def"
  }
]
```

### Create Appointment

```
POST /appointments
```

**Request Body:**

```json
{
  "doctorId": "doc-001",
  "doctorName": "Dr. Sarah Smith",
  "patientAddress": "GAKP...X7QM",
  "datetime": "2025-07-01T09:00:00Z",
  "type": "in-person",
  "notes": "Follow-up on blood work",
  "fee": 10
}
```

**Response:** `201 Created`

```json
{
  "id": "apt-001",
  "doctorId": "doc-001",
  "doctorName": "Dr. Sarah Smith",
  "patientAddress": "GAKP...X7QM",
  "datetime": "2025-07-01T09:00:00Z",
  "type": "in-person",
  "status": "pending",
  "fee": 10
}
```

### Cancel Appointment

```
PATCH /appointments/:id/cancel

---

## Hospital

### Get Metrics

```

GET /hospital/metrics

````

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `hospitalAddress` | `string` | Yes | Hospital's Stellar public key |

**Response:**
```json
{
  "totalPatients": 1200,
  "activeAdmissions": 45,
  "totalAppointments": 380,
  "monthlyRevenue": 125000,
  "complianceScore": 94,
  "staffCount": 89
}
````

### List Staff

```
GET /hospital/staff
```

**Query Parameters:**

| Param             | Type     | Required | Description                   |
| ----------------- | -------- | -------- | ----------------------------- |
| `hospitalAddress` | `string` | Yes      | Hospital's Stellar public key |

**Response:**

```json
[
  {
    "id": "stf-001",
    "name": "Dr. Sarah Smith",
    "role": "DOCTOR",
    "specialty": "Cardiology",
    "department": "Cardiology",
    "address": "GCMR...4BNP",
    "status": "active",
    "joinDate": "2024-12-03"
  }
]
```

### List Admissions

```
GET /hospital/admissions
```

**Query Parameters:**

| Param             | Type     | Required | Description                   |
| ----------------- | -------- | -------- | ----------------------------- |
| `hospitalAddress` | `string` | Yes      | Hospital's Stellar public key |

**Response:**

```json

---

## Users

### Get User Role

```

GET /users/:publicKey/role

````

**Response:**
```json
{
  "role": "PATIENT"
}
````

---

## Authentication

This frontend uses **Stellar wallet-based authentication** (not traditional JWT).

1. A user connects their Stellar wallet (Freighter, xBull, or LOBSTR).
2. The wallet's **public key** is sent to the backend to identify the user.
3. The backend returns the user's assigned **role** (`PATIENT`, `DOCTOR`, `HOSPITAL`, or `ADMIN`).
4. All subsequent requests include the public key as a query parameter or in the request body.
5. No API key or bearer token is required — access control is handled server-side based on the public key and role.

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "statusCode": 400
}
```

| Status Code | Meaning                                          |
| ----------- | ------------------------------------------------ |
| `400`       | Bad Request — invalid parameters                 |
| `401`       | Unauthorized — missing or invalid authentication |
| `403`       | Forbidden — insufficient role permissions        |
| `404`       | Not Found — resource does not exist              |
| `409`       | Conflict — duplicate or conflicting state        |
| `429`       | Too Many Requests — rate limit exceeded          |
| `500`       | Internal Server Error                            |

[
{
"id": "adm-001",
"patientName": "John Doe",
"patientAddress": "GAKP...X7QM",
"admissionDate": "2025-06-28",
"dischargeDate": null,
"department": "Emergency",
"status": "admitted",
"assignedDoctor": "Dr. Sarah Smith"
}
]

```

### List Compliance Reports

```

GET /hospital/compliance

````

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `hospitalAddress` | `string` | Yes | Hospital's Stellar public key |

**Response:**
```json
[
  {
    "id": "comp-001",
    "title": "HIPAA Compliance Audit",
    "type": "HIPAA",
    "status": "compliant",
    "lastAudit": "Jun 1, 2025",
    "nextAudit": "Sep 1, 2025",
    "score": 96
  }
]
````

### Bulk Update Staff

```
POST /hospital/staff/bulk
```

**Request Body:**

```json
{
  "hospitalAddress": "GPX2...9KLF",
  "staffIds": ["stf-001", "stf-002"],
  "action": "activate"
}
```

**Supported Actions:** `activate`, `deactivate`, `remove`

````

**Response:**
```json
{
  "id": "apt-001",
  "status": "cancelled"
}
````

### Update Appointment Status

```
PATCH /appointments/:id/status
```

**Request Body:**

```json
{
  "status": "confirmed"
}
```

**Response:**

```json
{
  "id": "apt-001",
  "status": "confirmed"
}
```

| `limit` | `number` | No | Page size (default: 10) |

**Response:**

```json
{
  "data": [
    {
      "name": "John Doe",
      "initials": "JD",
      "age": 34,
      "lastVisit": "Jun 3, 2025",
      "status": "active",
      "records": 24,
      "addr": "GAKP...X7QM"
    }
  ],
  "nextCursor": "xyz789",
  "total": 18
}
```

### Get Doctor Slots

```
GET /doctors/:doctorId/slots
```

**Response:**

```json
[
  {
    "id": "slot-001",
    "datetime": "2025-07-01T09:00:00Z",
    "available": true
  }
]
```

```

### Batch Import Records

```

POST /records/batch

````

**Request Body:**
```json
{
  "patientAddress": "GAKP...X7QM",
  "records": [
    {
      "date": "2025-01-15",
      "doctorName": "Dr. Emily Chen",
      "diagnosis": "Annual checkup",
      "prescription": "",
      "notes": "All vitals normal"
    }
  ]
}
````

**Response:**

```json
{
  "imported": 12,
  "failed": 1,
  "errors": [{ "row": 3, "message": "Missing required field: diagnosis" }],
  "records": [
    {
      "id": "HS-001402",
      "date": "2025-01-15T00:00:00Z",
      "doctorName": "Dr. Emily Chen",
      "diagnosis": "Annual checkup",
      "patientAddress": "GAKP...X7QM"
    }
  ]
}
```

```

```
