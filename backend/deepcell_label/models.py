"""SQL Alchemy database models."""
from __future__ import absolute_import, division, print_function

import io
import logging
import timeit
from secrets import token_urlsafe

import boto3
from flask_sqlalchemy import SQLAlchemy

from deepcell_label.config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET

logger = logging.getLogger('models.Project')  # pylint: disable=C0103
db = SQLAlchemy()  # pylint: disable=C0103


import os

db = SQLAlchemy()

class Project(db.Model):
    """Project table definition."""
    __tablename__ = 'projects'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project = db.Column(db.String(12), unique=True, nullable=False, index=True)
    createdAt = db.Column(db.TIMESTAMP, nullable=False, default=db.func.now())
    # bucket and key columns can be repurposed or removed if not needed
    bucket = db.Column(db.Text, nullable=True)
    key = db.Column(db.Text, nullable=True)

    def __init__(self, loader):
        """
        Initialize a new project with data from a loader.

        Args:
            loader: Loaders.Loader object containing the project data.
        """
        start = timeit.default_timer()

        # Create a unique 12 character base64 project ID
        while True:
            project_id = token_urlsafe(9)  # 9 bytes is 12 base64 characters
            if not db.session.query(Project).filter_by(project=project_id).first():
                self.project = project_id
                break

        # Define local storage path
        local_storage_path = '/rsrch5/home/plm/yshokrollahi/project4/apps/deepcell-label/backend'
        self.key = f'{self.project}.zip'  # Use project ID for the filename
        file_path = os.path.join(local_storage_path, self.key)

        # Setting a default value for bucket, even if it's not being used
        self.bucket = "local"

        # Write the project data to a file at the specified path
        with open(file_path, 'wb') as file:
            file.write(loader.data)

        logger.debug(
            'Initialized project %s and saved locally to %s in %ss.',
            self.project,
            file_path,
            timeit.default_timer() - start,
        )





    @staticmethod
    def get(project):
        """
        Return the project with the given ID, if it exists.

        Args:
            project (int): unique 12 character base64 string to identify project

        Returns:
            Project: row from the Project table
        """
        start = timeit.default_timer()
        project = db.session.query(Project).filter_by(project=project).first()
        logger.debug('Got project %s in %ss.', project, timeit.default_timer() - start)
        return project

    @staticmethod
    def create(data):
        """
        Create a new project in the Project table.

        Args:
            data: zip file with loaded project data

        Returns:
            Project: new row in the Project table
        """
        start = timeit.default_timer()
        project = Project(data)
        db.session.add(project)
        db.session.commit()
        logger.debug(
            'Created new project %s in %ss.',
            project.project,
            timeit.default_timer() - start,
        )
        return project
