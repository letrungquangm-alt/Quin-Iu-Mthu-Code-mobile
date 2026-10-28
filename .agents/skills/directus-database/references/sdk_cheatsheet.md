# Directus SDK & REST API Cheatsheet

## REST Endpoints Overview

| Action | HTTP Method | Endpoint | Example Body / Query |
| :--- | :--- | :--- | :--- |
| **Get Items** | `GET` | `/items/:collection` | `?filter[status][_eq]=published&limit=25` |
| **Get Item by ID** | `GET` | `/items/:collection/:id` | `?fields=*,author.name` |
| **Create Item** | `POST` | `/items/:collection` | `{"title": "Bài viết mới", "category_id": 3}` |
| **Update Item** | `PATCH` | `/items/:collection/:id` | `{"status": "archived"}` |
| **Delete Item** | `DELETE` | `/items/:collection/:id` | `(No body)` |
| **Upload Asset** | `POST` | `/files` | `multipart/form-data; file=@photo.jpg` |
| **Run Flow** | `POST` | `/flows/trigger/:id` | `{"order_id": 12345}` |

## GraphQL Queries

Directus automatically creates a GraphQL schema:
```graphql
query GetProjects {
  projects(filter: { status: { _eq: "active" } }, limit: 10) {
    id
    name
    status
    owner_id {
      first_name
      email
    }
  }
}
```
