"""Data models."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class User:
    """User model."""
    id: int
    name: str
    email: str
    created_at: Optional[datetime] = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()

    def full_display(self) -> str:
        """Return formatted display string."""
        return f"{self.name} <{self.email}>"


@dataclass
class Product:
    """Product model."""
    id: int
    name: str
    price: float
    description: str = ""
    in_stock: bool = True

    def discounted_price(self, percent: float) -> float:
        """Calculate discounted price."""
        return self.price * (1 - percent / 100)

    def __str__(self) -> str:
        return f"{self.name} (${self.price:.2f})"


@dataclass
class Order:
    """Order model."""
    id: int
    user: User
    products: list[Product]
    status: str = "pending"

    @property
    def total(self) -> float:
        """Calculate order total."""
        return sum(p.price for p in self.products)
