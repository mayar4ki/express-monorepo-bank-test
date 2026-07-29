### Objective

Your assignment is to build an internal API for a fake financial institution using Node and Express.

### Brief

While modern banks have evolved to serve a plethora of functions, at their core, banks must provide certain basic features. Today, your task is to build the basic HTTP API for one of those banks! Imagine you are designing a backend API for bank employees. It could ultimately be consumed by multiple frontends (web, iOS, Android etc).

### Tasks

- Implement assignment using:
  - Language: **Node**
  - Framework: **Express**
- There should be API routes that allow them to:
  - Create a new bank account for a customer, with an initial deposit amount. A
    single customer may have multiple bank accounts.
  - Transfer amounts between any two accounts, including those owned by
    different customers.
  - Retrieve balances for a given account.
  - Retrieve transfer history for a given account.
  - Transfers should be idempotent. More specifically, you should build a queueing system that executes transfers one by one to prevent double spendings on race conditions.
  - Apply internal comments on customers accounts
  - Apply locks with freetext reason on customers accounts to prevent further incoming and outgoing transactions while this lock is active.
  - Remove locks from customers.
- Write tests for your business logic
- Write a production ready Dockerfile to build your backend code
- Write a docker-compose.yml that runs the backend code and any other required containers like database etc.
- Please write a document listing all API routes, how to use them and what they do.

Feel free to pre-populate your customers with the following:

```json
[
  {
    "id": 1,
    "name": "Arisha Barron"
  },
  {
    "id": 2,
    "name": "Branden Gibson"
  },
  {
    "id": 3,
    "name": "Rhonda Church"
  },
  {
    "id": 4,
    "name": "Georgina Hazel"
  }
]
```

You are expected to design any other required models and routes for your API.

### Evaluation Criteria

- **Node** best practices
- Completeness: did you complete the features?
- Correctness: does the functionality act in sensible, thought-out ways?
- Maintainability: is it written in a clean, maintainable way?
- Testing: is the system adequately tested?
- Documentation: is the API well-documented?

### CodeSubmit

Please organize, design, test and document your code as if it were going into production - then push your changes to the master branch. After you have pushed your code, you may submit the assignment on the assignment page.

All the best and happy coding,

The Titan Tech Team
