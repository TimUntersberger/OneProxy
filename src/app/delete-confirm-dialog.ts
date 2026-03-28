import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

interface DeleteConfirmDialogData {
  itemId: string;
  itemName: string;
}

@Component({
  selector: 'app-delete-confirm-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Delete Proxy?</h2>
    <mat-dialog-content>
      <p>
        This will remove <strong>{{ data.itemName }}</strong> from the library and permanently
        delete its Drive folder and files.
      </p>
      <p><strong>Item ID:</strong> {{ data.itemId }}</p>
      <p>This action cannot be undone.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-stroked-button type="button" (click)="dialogRef.close(false)">Cancel</button>
      <button mat-flat-button type="button" (click)="dialogRef.close(true)">Delete</button>
    </mat-dialog-actions>
  `,
})
export class DeleteConfirmDialogComponent {
  readonly dialogRef = inject(MatDialogRef<DeleteConfirmDialogComponent, boolean>);
  readonly data = inject<DeleteConfirmDialogData>(MAT_DIALOG_DATA);
}
