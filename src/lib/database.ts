export type Role = "manager" | "performer";
export type Status =
  "new" | "in_progress" | "in_review" | "accepted" | "rework";
export type AssignmentMode = "direct" | "candidates" | "open";

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
          assignee_id: string | null;
          assignment_mode: AssignmentMode;
          author_id: string;
          status: Status;
          created_at: string;
        },
        {
          title: string;
          description?: string;
          object_id: string;
          assignee_id: string | null;
          assignment_mode: AssignmentMode;
        },
        {
          title?: string;
          description?: string;
          object_id?: string;
          assignee_id?: string | null;
          assignment_mode?: AssignmentMode;
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
      task_candidates: Table<
        { task_id: string; performer_id: string },
        { task_id: string; performer_id: string },
        never
      >;
      task_comments: Table<
        {
          id: number;
          task_id: string;
          author_id: string;
          body: string;
          created_at: string;
        },
        { task_id: string; body: string },
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
      save_task: {
        Args: {
          p_task_id: string | null;
          p_title: string;
          p_description: string;
          p_object_id: string;
          p_assignment_mode: AssignmentMode;
          p_assignee_id: string | null;
          p_candidate_ids?: string[];
        };
        Returns: string;
      };
      claim_task: { Args: { p_task_id: string }; Returns: undefined };
    };
    Enums: { assignment_mode: AssignmentMode };
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
