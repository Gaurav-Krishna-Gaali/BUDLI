from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
import uuid

from database import Base

class RunModel(Base):
    __tablename__ = "runs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    status = Column(String, nullable=False) # "pending", "processing", "completed", "error"
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    devices = Column(JSONB, default=list) # Array of DeviceInput objects
    results = Column(JSONB, default=list) # Array of PricingResult objects
    feedback_submitted = Column(Boolean, default=False)

class KnowledgeBaseEntryModel(Base):
    __tablename__ = "knowledge_base"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    brand = Column(String, nullable=False)
    model = Column(String, nullable=False)
    ram = Column(String, nullable=False)
    storage = Column(String, nullable=False)
    condition_tier = Column(String, nullable=False)
    
    recommended_price = Column(Integer, nullable=False)
    human_approved_price = Column(Integer, nullable=False)
    delta = Column(Integer, nullable=False) # human - recommended
    
    velocity_category = Column(String, nullable=False)
    human_velocity_override = Column(String, nullable=True)
    feedback_note = Column(String, nullable=True)
    
    run_id = Column(String(36), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
