export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          active: boolean
          bank: string | null
          created_at: string
          entity_id: string
          id: string
          is_demo: boolean
          name: string
          opening_balance: number
          type: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          bank?: string | null
          created_at?: string
          entity_id: string
          id?: string
          is_demo?: boolean
          name: string
          opening_balance?: number
          type?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          bank?: string | null
          created_at?: string
          entity_id?: string
          id?: string
          is_demo?: boolean
          name?: string
          opening_balance?: number
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          body: string
          created_at: string
          entity_id: string | null
          id: string
          is_demo: boolean
          severity: string
          title: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          entity_id?: string | null
          id?: string
          is_demo?: boolean
          severity?: string
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          entity_id?: string | null
          id?: string
          is_demo?: boolean
          severity?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      budgets: {
        Row: {
          category_id: string
          created_at: string
          entity_id: string
          id: string
          is_demo: boolean
          month: string
          planned_amount: number
          user_id: string | null
        }
        Insert: {
          category_id: string
          created_at?: string
          entity_id: string
          id?: string
          is_demo?: boolean
          month: string
          planned_amount?: number
          user_id?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string
          entity_id?: string
          id?: string
          is_demo?: boolean
          month?: string
          planned_amount?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string
          created_at: string
          id: string
          is_demo: boolean
          kind: string
          name: string
          user_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          kind?: string
          name: string
          user_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          kind?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      credit_card_installments: {
        Row: {
          amount: number
          created_at: string
          credit_card_id: string
          due_date: string
          id: string
          installment_no: number
          is_demo: boolean
          purchase_id: string
          status: string
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          credit_card_id: string
          due_date: string
          id?: string
          installment_no: number
          is_demo?: boolean
          purchase_id: string
          status?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          credit_card_id?: string
          due_date?: string
          id?: string
          installment_no?: number
          is_demo?: boolean
          purchase_id?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_installments_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_installments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "credit_card_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_card_purchases: {
        Row: {
          category_id: string | null
          created_at: string
          credit_card_id: string
          description: string
          entity_id: string
          id: string
          installments: number
          is_demo: boolean
          purchase_date: string
          total_amount: number
          user_id: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          credit_card_id: string
          description: string
          entity_id: string
          id?: string
          installments?: number
          is_demo?: boolean
          purchase_date?: string
          total_amount: number
          user_id?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          credit_card_id?: string
          description?: string
          entity_id?: string
          id?: string
          installments?: number
          is_demo?: boolean
          purchase_date?: string
          total_amount?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_purchases_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_purchases_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_purchases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_cards: {
        Row: {
          account_id: string | null
          active: boolean
          brand: string | null
          closing_day: number
          created_at: string
          credit_limit: number
          due_day: number
          entity_id: string
          id: string
          is_demo: boolean
          name: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          brand?: string | null
          closing_day?: number
          created_at?: string
          credit_limit?: number
          due_day?: number
          entity_id: string
          id?: string
          is_demo?: boolean
          name: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean
          brand?: string | null
          closing_day?: number
          created_at?: string
          credit_limit?: number
          due_day?: number
          entity_id?: string
          id?: string
          is_demo?: boolean
          name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_cards_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_cards_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_documents: {
        Row: {
          created_at: string
          entity_id: string | null
          file_name: string
          id: string
          mime_type: string | null
          notes: string | null
          size_bytes: number | null
          source: string
          status: string
          storage_path: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          file_name: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          size_bytes?: number | null
          source?: string
          status?: string
          storage_path: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          file_name?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          size_bytes?: number | null
          source?: string
          status?: string
          storage_path?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_documents_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_documents_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_entities: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          is_demo: boolean
          kind: string
          name: string
          slug: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          kind?: string
          name: string
          slug: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          kind?: string
          name?: string
          slug?: string
          user_id?: string | null
        }
        Relationships: []
      }
      financial_snapshots: {
        Row: {
          balance: number
          created_at: string
          entity_id: string | null
          free_cash: number
          id: string
          is_demo: boolean
          payload: Json | null
          snapshot_date: string
          user_id: string | null
        }
        Insert: {
          balance?: number
          created_at?: string
          entity_id?: string | null
          free_cash?: number
          id?: string
          is_demo?: boolean
          payload?: Json | null
          snapshot_date?: string
          user_id?: string | null
        }
        Update: {
          balance?: number
          created_at?: string
          entity_id?: string | null
          free_cash?: number
          id?: string
          is_demo?: boolean
          payload?: Json | null
          snapshot_date?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_snapshots_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      recurring_transactions: {
        Row: {
          account_id: string | null
          active: boolean
          amount: number
          category_id: string | null
          created_at: string
          day_of_month: number | null
          description: string
          entity_id: string
          frequency: string
          id: string
          is_demo: boolean
          kind: string
          next_run: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          amount: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          description: string
          entity_id: string
          frequency?: string
          id?: string
          is_demo?: boolean
          kind: string
          next_run?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean
          amount?: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          description?: string
          entity_id?: string
          frequency?: string
          id?: string
          is_demo?: boolean
          kind?: string
          next_run?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      reserves: {
        Row: {
          account_id: string | null
          created_at: string
          current_amount: number
          entity_id: string
          id: string
          is_demo: boolean
          name: string
          notes: string | null
          target_amount: number
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          current_amount?: number
          entity_id: string
          id?: string
          is_demo?: boolean
          name: string
          notes?: string | null
          target_amount?: number
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          current_amount?: number
          entity_id?: string
          id?: string
          is_demo?: boolean
          name?: string
          notes?: string | null
          target_amount?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reserves_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reserves_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          competence_date: string
          created_at: string
          credit_card_id: string | null
          deleted_at: string | null
          description: string
          due_date: string | null
          entity_id: string
          id: string
          installment_no: number | null
          installment_total: number | null
          is_demo: boolean
          kind: string
          notes: string | null
          paid_at: string | null
          payment_method: string
          recurrence: string
          source: string
          status: string
          to_account_id: string | null
          to_entity_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          competence_date?: string
          created_at?: string
          credit_card_id?: string | null
          deleted_at?: string | null
          description: string
          due_date?: string | null
          entity_id: string
          id?: string
          installment_no?: number | null
          installment_total?: number | null
          is_demo?: boolean
          kind: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          recurrence?: string
          source?: string
          status?: string
          to_account_id?: string | null
          to_entity_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          competence_date?: string
          created_at?: string
          credit_card_id?: string | null
          deleted_at?: string | null
          description?: string
          due_date?: string | null
          entity_id?: string
          id?: string
          installment_no?: number | null
          installment_total?: number | null
          is_demo?: boolean
          kind?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          recurrence?: string
          source?: string
          status?: string
          to_account_id?: string | null
          to_entity_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_to_entity_id_fkey"
            columns: ["to_entity_id"]
            isOneToOne: false
            referencedRelation: "financial_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_commands: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          parsed: Json | null
          phone: string | null
          raw_message: string
          status: string
          transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          parsed?: Json | null
          phone?: string | null
          raw_message: string
          status?: string
          transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
          parsed?: Json | null
          phone?: string | null
          raw_message?: string
          status?: string
          transaction_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_commands_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_settings: {
        Row: {
          business_account_id: string | null
          created_at: string
          display_phone_number: string | null
          id: string
          last_webhook_at: string | null
          phone_number_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          business_account_id?: string | null
          created_at?: string
          display_phone_number?: string | null
          id?: string
          last_webhook_at?: string | null
          phone_number_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          business_account_id?: string | null
          created_at?: string
          display_phone_number?: string | null
          id?: string
          last_webhook_at?: string | null
          phone_number_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      card_due_date: {
        Args: { _due_day: number; _month: string }
        Returns: string
      }
      create_credit_card_purchase: {
        Args: {
          _category_id: string
          _credit_card_id: string
          _description: string
          _installments?: number
          _purchase_date: string
          _total_amount: number
        }
        Returns: string
      }
      ensure_finance_workspace: {
        Args: { _user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
