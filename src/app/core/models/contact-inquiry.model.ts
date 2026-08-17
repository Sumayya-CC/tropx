export type ContactInquiryStatus = 'new' | 'read' | 'resolved';

export interface ContactInquiry {
  id: string;
  name: string;
  email: string;
  phone?: string;
  businessName: string;
  message: string;
  status: ContactInquiryStatus;
  tenantId: number;
  createdAt: any;
  notificationSentAt?: any;
  rateLimited?: boolean;
}
