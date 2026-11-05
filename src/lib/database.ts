export type Role = "manager" | "performer";
export type Status =
  "new" | "in_progress" | "in_review" | "accepted" | "rework";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        { id: string; display_name: string; role: Role },
        { id: string; display_name: string; role: Role },
        { display_name?: string; role?: Role }
      >;
      objects: Table<
        { id: string; title: string; address: string },
        { title: string; address: string },
        { title?: string; address?: string }
      >;
      tasks: Table<
        {
          id: string;
          title: string;
          description: string;
          object_id: string;
          assignee_id: string;
          author_id: string;
          status: Status;
          created_at: string;
        },
        {
          title: string;
          description?: string;
          object_id: string;
          assignee_id: string;
        },
        {
          title?: string;
          description?: string;
          object_id?: string;
          assignee_id?: string;
        }
      >;
      task_status_history: Table<
        {
          id: number;
          task_id: string;
          actor_id: string;
          from_status: Status | null;
          to_status: Status;
          comment: string | null;
          created_at: string;
        },
        never,
        never
      >;
    };
    Views: Record<string, never>;
    Functions: {
      transition_task: {
        Args: {
          p_task_id: string;
          p_to_status: Status;
          p_comment?: string | null;
        };
        Returns: undefined;
      };
      delete_task: { Args: { p_task_id: string }; Returns: undefined };
      delete_object: { Args: { p_object_id: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ObjectRow = Database["public"]["Tables"]["objects"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type HistoryRow =
  Database["public"]["Tables"]["task_status_history"]["Row"];

export const statusLabel: Record<Status, string> = {
  new: "Новая",
  in_progress: "В работе",
  in_review: "На проверке",
  accepted: "Принята",
  rework: "На доработке",
};
