// generate-db.js
const fs = require('fs');

const database = {
  "users": [
    {
      "id": 1,
      "username": "admin",
      "password": "admin123",
      "token": "mock-jwt-token-1"
    },
    {
      "id": 2,
      "username": "manager",
      "password": "manager123",
      "token": "mock-jwt-token-2"
    }
  ],
  "products": [
    {
      "id": 1,
      "name": "Laptop Dell XPS 15",
      "category": "Electronics",
      "quantity": 15,
      "price": 1499.99,
      "supplier": "TechSupply Co.",
      "dateAdded": "2024-01-15T10:30:00Z"
    },
    {
      "id": 2,
      "name": "Office Desk Chair",
      "category": "Furniture",
      "quantity": 3,
      "price": 249.99,
      "supplier": "OfficeFurnishings Ltd",
      "dateAdded": "2024-02-20T14:45:00Z"
    },
    {
      "id": 3,
      "name": "Wireless Mouse",
      "category": "Electronics",
      "quantity": 4,
      "price": 29.99,
      "supplier": "TechSupply Co.",
      "dateAdded": "2024-03-01T09:15:00Z"
    }
  ],
  "categories": [
    {
      "id": 1,
      "name": "Electronics",
      "description": "Electronic devices and accessories"
    },
    {
      "id": 2,
      "name": "Furniture",
      "description": "Office furniture including desks and chairs"
    },
    {
      "id": 3,
      "name": "Stationery",
      "description": "Paper products and office supplies"
    }
  ]
};

// Write file without BOM
fs.writeFileSync('db.json', JSON.stringify(database, null, 2), 'utf8');
console.log('✅ db.json created successfully for Angular project!');